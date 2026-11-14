// Ithaca weather from the US National Weather Service API (api.weather.gov): conditions at the
// Ithaca airport station (KITH), the forecast for the grid cell over central campus, and active
// alerts. Public, no key.

import { HttpError, cachedFetch, fmtDayTime, fmtTime, intArg } from './util.mjs';

const NWS = 'https://api.weather.gov';
const POINT = '42.4534,-76.4735';
const STATION = 'KITH';
// Grid cell for POINT; re-resolved through /points if the NWS ever re-grids and this 404s.
let grid = 'BGM/45,71';

const OBS_TTL_MS = 10 * 60 * 1000;
const FORECAST_TTL_MS = 30 * 60 * 1000;
const ALERTS_TTL_MS = 5 * 60 * 1000;
const HEADERS = { accept: 'application/geo+json' };

async function forecastFetch(kind) {
  const url = () => `${NWS}/gridpoints/${grid}/forecast${kind === 'hourly' ? '/hourly' : ''}`;
  try {
    return await cachedFetch(url(), { ttlMs: FORECAST_TTL_MS, edge: true, headers: HEADERS });
  } catch (err) {
    if (!(err instanceof HttpError && err.status === 404)) throw err;
    const { data } = await cachedFetch(`${NWS}/points/${POINT}`, { ttlMs: 24 * 3600 * 1000, headers: HEADERS });
    const p = data?.properties;
    if (!p?.gridId) throw err;
    grid = `${p.gridId}/${p.gridX},${p.gridY}`;
    return cachedFetch(url(), { ttlMs: FORECAST_TTL_MS, edge: true, headers: HEADERS });
  }
}

const num = (q) => (q && typeof q.value === 'number' ? q.value : null);
const cToF = (c) => (c == null ? null : Math.round((c * 9) / 5 + 32));
const kmhToMph = (k) => (k == null ? null : Math.round(k * 0.621371));
const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const compass = (deg) => (deg == null ? null : COMPASS[Math.round(deg / 22.5) % 16]);

function shapeObservation(props, nowMs) {
  if (!props) return null;
  const t = num(props.temperature);
  const at = Date.parse(props.timestamp);
  const wind = kmhToMph(num(props.windSpeed));
  const gust = kmhToMph(num(props.windGust));
  const feels = num(props.windChill) ?? num(props.heatIndex);
  const out = {
    station: props.stationName || STATION,
    observed: Number.isFinite(at) ? fmtDayTime(at) : null,
    ...(Number.isFinite(at) ? { minutes_ago: Math.round((nowMs - at) / 60000) } : {}),
    conditions: props.textDescription || null,
    temperature_f: cToF(t),
    ...(t != null ? { temperature_c: Math.round(t) } : {}),
    ...(feels != null && cToF(feels) !== cToF(t) ? { feels_like_f: cToF(feels) } : {}),
    ...(num(props.relativeHumidity) != null ? { humidity_percent: Math.round(num(props.relativeHumidity)) } : {}),
    ...(wind != null ? { wind: wind === 0 ? 'calm' : `${compass(num(props.windDirection)) || ''} ${wind} mph`.trim() + (gust ? `, gusts ${gust} mph` : '') } : {}),
    ...(num(props.visibility) != null ? { visibility_miles: Math.round(num(props.visibility) / 160.934) / 10 } : {}),
  };
  return out;
}

function shapePeriod(p) {
  const pop = num(p.probabilityOfPrecipitation);
  return {
    name: p.name,
    temperature_f: p.temperature,
    ...(pop != null ? { precipitation_chance_percent: pop } : {}),
    wind: `${p.windDirection || ''} ${p.windSpeed || ''}`.trim(),
    forecast: p.detailedForecast || p.shortForecast,
  };
}

function shapeHour(p) {
  const pop = num(p.probabilityOfPrecipitation);
  return {
    time: fmtDayTime(Date.parse(p.startTime)),
    temperature_f: p.temperature,
    ...(pop != null ? { precipitation_chance_percent: pop } : {}),
    wind: `${p.windDirection || ''} ${p.windSpeed || ''}`.trim(),
    conditions: p.shortForecast,
  };
}

function shapeAlert(f) {
  const p = f.properties || {};
  return {
    event: p.event,
    severity: p.severity,
    headline: p.headline,
    ...(p.ends || p.expires ? { until: fmtDayTime(Date.parse(p.ends || p.expires)) } : {}),
    ...(p.instruction ? { instruction: String(p.instruction).replace(/\s+/g, ' ').slice(0, 300) } : {}),
  };
}

export async function weatherIthaca(args = {}, nowMs = Date.now()) {
  const hourly = args.hourly === true;
  const periods = intArg(args.periods, hourly ? 12 : 6, 1, hourly ? 48 : 14);
  const settle = (p) => p.then((v) => ({ ok: v }), (e) => ({ err: e }));
  const [obs, fc, alerts] = await Promise.all([
    settle(cachedFetch(`${NWS}/stations/${STATION}/observations/latest`, { ttlMs: OBS_TTL_MS, edge: true, headers: HEADERS })),
    settle(forecastFetch(hourly ? 'hourly' : 'daily')),
    settle(cachedFetch(`${NWS}/alerts/active?point=${POINT}`, { ttlMs: ALERTS_TTL_MS, edge: true, headers: HEADERS })),
  ]);
  if (obs.err && fc.err) throw fc.err;
  const warnings = [];
  if (obs.err) warnings.push(`Current conditions unavailable (${obs.err.message}).`);
  if (fc.err) warnings.push(`Forecast unavailable (${fc.err.message}).`);
  if (alerts.err) warnings.push('Alerts could not be checked.');
  const list = fc.ok?.data?.properties?.periods || [];
  const upcoming = hourly ? list.filter((p) => Date.parse(p.endTime) > nowMs) : list;
  return {
    as_of: fmtDayTime(nowMs),
    place: 'Ithaca, NY (Cornell campus)',
    ...(obs.ok ? { now: shapeObservation(obs.ok.data?.properties, nowMs) } : {}),
    ...(alerts.ok ? { alerts: (alerts.ok.data?.features || []).map(shapeAlert) } : {}),
    ...(fc.ok ? { [hourly ? 'hourly' : 'forecast']: upcoming.slice(0, periods).map(hourly ? shapeHour : shapePeriod) } : {}),
    ...(fc.ok?.data?.properties?.updateTime ? { forecast_issued: `${fmtDayTime(Date.parse(fc.ok.data.properties.updateTime))}` } : {}),
    ...(warnings.length ? { warnings } : {}),
    source: 'US National Weather Service (weather.gov), Binghamton office; observations from Ithaca Tompkins International Airport, about 5 km from central campus',
  };
}

export const _internal = { shapeObservation, shapePeriod, shapeHour, shapeAlert, fmtTime };
