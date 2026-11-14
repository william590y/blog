// TCAT (Tompkins Consolidated Area Transit) buses: stops, next departures with real-time
// estimates, and service alerts, from the InfoPoint feed behind TCAT's own bus tracker
// (realtimetcatbus.availtec.com). Unauthenticated and read-only.

import { InputError, cachedFetch, distanceKm, easternToEpoch, fmtDayTime, fmtTime, intArg, matchScore, minutesBetween, normalize, truncate } from './util.mjs';

const BASE = 'https://realtimetcatbus.availtec.com/InfoPoint/rest';
const STOPS_TTL_MS = 24 * 60 * 60 * 1000;
const ROUTES_TTL_MS = 6 * 60 * 60 * 1000;
const DEPARTURES_TTL_MS = 30 * 1000;
const ALERTS_TTL_MS = 5 * 60 * 1000;
const FALLBACK = 'https://tcatbus.com';

async function loadStops() {
  const { data } = await cachedFetch(`${BASE}/Stops/GetAllStops`, { ttlMs: STOPS_TTL_MS, edge: true });
  if (!Array.isArray(data)) throw new Error('Unexpected TCAT reply (stops).');
  return data.map((s) => ({ id: s.StopId, name: String(s.Name || s.Description || '').trim(), lat: s.Latitude, lng: s.Longitude }));
}

async function loadRoutes() {
  const { data } = await cachedFetch(`${BASE}/Routes/GetVisibleRoutes`, { ttlMs: ROUTES_TTL_MS, edge: true });
  if (!Array.isArray(data)) throw new Error('Unexpected TCAT reply (routes).');
  const map = new Map();
  for (const r of data) map.set(r.RouteId, { number: r.RouteAbbreviation || String(r.RouteId), name: r.LongName || r.ShortName || '' });
  return map;
}

/** Stop names abbreviate ("Rockefeller Hall", "Sage Hall", "@"), so match on words loosely. */
function scoreStop(query, stop) {
  const s = matchScore(query, stop.name);
  if (s) return s;
  const q = normalize(query).split(' ');
  const n = normalize(stop.name);
  return q.every((w) => n.includes(w)) ? 35 : 0;
}

function findStops(stops, text, max = 8) {
  const t = String(text).trim();
  if (/^\d+$/.test(t)) {
    const byId = stops.find((s) => String(s.id) === t);
    if (byId) return [byId];
  }
  return stops
    .map((s) => ({ s, score: scoreStop(t, s) }))
    .filter((x) => x.score >= 35)
    .sort((a, b) => b.score - a.score || a.s.name.localeCompare(b.s.name))
    .slice(0, max)
    .map((x) => x.s);
}

/** "2026-11-14T07:08:00" (Ithaca wall clock) -> epoch ms. */
function localToEpoch(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(s || '');
  return m ? easternToEpoch(+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] || 0)) : null;
}

function shapeDepartures(payload, routes, nowMs, { route, limit }) {
  const rows = [];
  for (const stop of payload || []) {
    for (const rd of stop.RouteDirections || []) {
      const r = routes.get(rd.RouteId) || { number: String(rd.RouteId), name: '' };
      if (route && normalize(String(route)) !== normalize(r.number)) continue;
      for (const d of rd.Departures || []) {
        const sched = localToEpoch(d.SDTLocalTime);
        const est = localToEpoch(d.EDTLocalTime) ?? sched;
        if (est == null || est < nowMs - 60000) continue;
        const late = sched != null ? minutesBetween(sched, est) : 0;
        const live = d.StopStatusReportLabel && d.StopStatusReportLabel !== 'Scheduled';
        rows.push({
          route: r.number,
          to: d.Trip?.InternetServiceDesc || d.Trip?.InternalSignDesc || rd.Direction || '',
          departs: fmtTime(est),
          in_minutes: Math.max(0, minutesBetween(nowMs, est)),
          ...(sched != null && late !== 0 ? { scheduled: fmtTime(sched) } : {}),
          status: !live ? 'scheduled (no live estimate yet)' : late > 1 ? `${late} min late` : late < -1 ? `${-late} min early` : 'on time',
          _t: est,
        });
      }
    }
  }
  rows.sort((a, b) => a._t - b._t);
  return rows.slice(0, limit).map(({ _t, ...r }) => r);
}

export async function tcatStopSearch(args = {}) {
  const stops = await loadStops();
  const limit = intArg(args.limit, 10, 1, 25);
  const near = args.near ? /^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(String(args.near)) : null;
  if (args.near && !near) throw new InputError('near must be "lat,lng", e.g. "42.4470,-76.4832" (campus_place_search gives coordinates for a building).');
  let rows;
  if (args.query) {
    rows = findStops(stops, args.query, near ? 200 : limit);
  } else if (near) {
    rows = stops;
  } else {
    throw new InputError('Give a query (part of a stop name, e.g. "Sage Hall", "Commons", "Collegetown") or near as "lat,lng".');
  }
  if (near) {
    const [lat, lng] = [+near[1], +near[2]];
    rows = rows
      .map((s) => ({ ...s, meters_away: Math.round(distanceKm(lat, lng, s.lat, s.lng) * 1000) }))
      .sort((a, b) => a.meters_away - b.meters_away)
      .slice(0, limit);
  }
  return {
    count: rows.length,
    stops: rows.map((s) => ({ stop_id: s.id, name: s.name, lat: s.lat, lng: s.lng, ...(s.meters_away !== undefined ? { meters_away: s.meters_away } : {}) })),
    ...(rows.length ? { use: 'Pass stop_id to tcat_departures. Many stops come in pairs, one per direction.' } : { note: 'No stop matches. Try a shorter name, e.g. a building or street.' }),
    source: FALLBACK,
  };
}

export async function tcatDepartures(args = {}, nowMs = Date.now()) {
  const text = String(args.stop ?? '').trim();
  if (!text) throw new InputError('stop is required: a stop id from tcat_stop_search or part of a stop name, e.g. "Sage Hall".');
  const [stops, routes] = await Promise.all([loadStops(), loadRoutes()]);
  // A name can match many stops; keep the best-scoring ones (typically the two sides of the street).
  const found = findStops(stops, text, 12);
  const top = found.length ? scoreStop(text, found[0]) : 0;
  const matches = /^\d+$/.test(text) ? found.slice(0, 1) : found.filter((s) => scoreStop(text, s) >= Math.min(top, 80)).slice(0, 4);
  if (!matches.length) throw new InputError(`No TCAT stop matches "${text}". Use tcat_stop_search to find the stop.`);
  const limit = intArg(args.limit, 8, 1, 25);
  const results = await Promise.all(
    matches.map(async (s) => {
      const { data, fetchedAt, stale } = await cachedFetch(`${BASE}/StopDepartures/Get/${s.id}`, { ttlMs: DEPARTURES_TTL_MS });
      return { stop_id: s.id, stop: s.name, departures: shapeDepartures(data, routes, nowMs, { route: args.route, limit }), fetchedAt, stale };
    }),
  );
  return {
    as_of: fmtDayTime(nowMs),
    ...(args.route ? { route: String(args.route) } : {}),
    stops: results.map(({ fetchedAt, stale, ...r }) => ({
      ...r,
      ...(r.departures.length ? {} : { note: 'No upcoming departures listed for this stop right now.' }),
      ...(stale ? { warning: 'Feed unreachable; showing the last copy fetched.' } : {}),
    })),
    ...(matches.length > 1 ? { note: `"${text}" matches ${matches.length} stops (often one per direction); pass a stop_id for just one.` } : {}),
    source: `${FALLBACK} (real-time feed)`,
  };
}

/** "/Date(1777348800000-0400)/" -> epoch ms. */
function msDate(s) {
  const m = /\/Date\((-?\d+)/.exec(s || '');
  return m ? +m[1] : null;
}

function shapeAlerts(list, routes, nowMs) {
  return (list || [])
    .filter((m) => m.Published !== false)
    .filter((m) => {
      const to = msDate(m.ToDate);
      return !to || to + 86400000 > nowMs;
    })
    .map((m) => {
      const from = msDate(m.FromDate);
      const to = msDate(m.ToDate);
      const rts = (m.Routes || []).map((id) => routes.get(id)?.number || String(id));
      return {
        ...(m.EffectReportLabel ? { effect: m.EffectReportLabel } : {}),
        ...(m.CauseReportLabel ? { cause: m.CauseReportLabel } : {}),
        ...(rts.length ? { routes: rts } : {}),
        message: truncate(m.Message || m.Header || '', 500),
        ...(from ? { from: fmtDayTime(from).replace(/, [^,]*$/, '') } : {}),
        ...(to ? { until: fmtDayTime(to).replace(/, [^,]*$/, '') } : {}),
      };
    });
}

export async function tcatAlerts(args = {}, nowMs = Date.now()) {
  const [{ data, fetchedAt }, routes] = await Promise.all([
    cachedFetch(`${BASE}/PublicMessages/GetCurrentMessages`, { ttlMs: ALERTS_TTL_MS, edge: true }),
    loadRoutes(),
  ]);
  if (!Array.isArray(data)) throw new Error('Unexpected TCAT reply (messages).');
  let alerts = shapeAlerts(data, routes, nowMs);
  if (args.route) {
    const r = normalize(String(args.route));
    // Many alerts name their route only in the text; one that names no route at all applies to every route.
    const inText = new RegExp(`\\broutes? (\\w+(, | and | & ))*${r}\\b`, 'i');
    alerts = alerts.filter((a) =>
      a.routes ? a.routes.some((x) => normalize(x) === r) : inText.test(a.message) || !/\broutes? \d/i.test(a.message),
    );
  }
  return {
    as_of: fmtDayTime(nowMs),
    count: alerts.length,
    alerts,
    ...(alerts.length ? {} : { note: 'No current service alerts.' }),
    routes: [...routes.values()].map((r) => `${r.number}: ${r.name.replace(/^Route \S+ - /, '')}`),
    source: FALLBACK,
    fetched_at: fmtDayTime(fetchedAt),
  };
}

export const _internal = { findStops, shapeDepartures, shapeAlerts, localToEpoch, msDate };
