// eBird API 2.0 (api.ebird.org, Cornell Lab of Ornithology): recent and notable sightings,
// hotspots and species lookup around Ithaca. The API needs a key, which is read from the
// EBIRD_API_KEY environment variable of the Cloudflare Pages project and sent as a header (never
// in a URL, never in this repository). Without it every eBird tool reports "not configured".

import { HttpError, InputError, cachedFetch, distanceKm, fmtDayTime, intArg, matchScore, normalize } from './util.mjs';

const BASE = 'https://api.ebird.org/v2';
const OBS_TTL_MS = 5 * 60 * 1000;
const REF_TTL_MS = 24 * 60 * 60 * 1000;

// Ho Plaza, the middle of Cornell's central campus.
const CAMPUS = { lat: 42.447, lng: -76.4832, name: 'Cornell central campus' };
const COUNTY = { code: 'US-NY-109', name: 'Tompkins County, NY' };
const HOTSPOT_SEARCH_KM = 30;

export const EBIRD_NOT_CONFIGURED =
  'eBird is not configured on this server: the EBIRD_API_KEY environment variable is not set, so eBird tools cannot run. ' +
  'The site owner can request a free key at https://ebird.org/api/keygen and add it to the Cloudflare Pages project as EBIRD_API_KEY. ' +
  'Meanwhile see https://ebird.org/region/US-NY-109 (Tompkins County) or https://ebird.org/hotspots.';

function keyOf(env) {
  const key = typeof env?.EBIRD_API_KEY === 'string' ? env.EBIRD_API_KEY.trim() : '';
  if (!key) throw new InputError(EBIRD_NOT_CONFIGURED);
  return key;
}

async function api(path, key, ttlMs) {
  try {
    const { data, fetchedAt } = await cachedFetch(`${BASE}${path}`, {
      ttlMs,
      edge: true,
      headers: key ? { 'x-ebirdapitoken': key } : null,
    });
    return { data, fetchedAt };
  } catch (err) {
    if (err instanceof HttpError && (err.status === 401 || err.status === 403)) {
      throw new Error('eBird rejected the API key configured on this server (EBIRD_API_KEY); the site owner needs to check it');
    }
    if (err instanceof HttpError && err.status === 429) throw new Error('eBird rate limit reached; try again in a few minutes');
    throw err;
  }
}

async function loadHotspots(key, lat = CAMPUS.lat, lng = CAMPUS.lng, km = HOTSPOT_SEARCH_KM) {
  const q = `lat=${lat.toFixed(4)}&lng=${lng.toFixed(4)}&dist=${km}&fmt=json`;
  const { data, fetchedAt } = await api(`/ref/hotspot/geo?${q}`, key, REF_TTL_MS);
  if (!Array.isArray(data)) throw new Error('Unexpected eBird reply (hotspots).');
  return { hotspots: data, fetchedAt };
}

function parseLatLng(text) {
  const m = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(text);
  if (!m) return null;
  const lat = +m[1];
  const lng = +m[2];
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

/** A place argument -> {kind: 'geo', lat, lng, name} or {kind: 'code', code, name}. */
async function resolveLocation(text, key) {
  const t = String(text ?? '').trim();
  const n = normalize(t);
  if (!t || /^(campus|cornell|cornell campus|central campus|here|ithaca)$/.test(n)) return { kind: 'geo', ...CAMPUS };
  if (/^(tompkins|tompkins county|county|the county|ithaca area)$/.test(n)) return { kind: 'code', ...COUNTY };
  const ll = parseLatLng(t);
  if (ll) return { kind: 'geo', ...ll, name: `${ll.lat}, ${ll.lng}` };
  if (/^L\d+$/i.test(t)) return { kind: 'code', code: t.toUpperCase(), name: `hotspot ${t.toUpperCase()}` };
  if (/^[A-Za-z]{2}(-[A-Za-z0-9]{1,3}){0,2}$/.test(t) && t.includes('-')) return { kind: 'code', code: t.toUpperCase(), name: `region ${t.toUpperCase()}` };
  const { hotspots } = await loadHotspots(key);
  const scored = hotspots
    .map((h) => ({ h, s: matchScore(t, h.locName) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || (b.h.numSpeciesAllTime || 0) - (a.h.numSpeciesAllTime || 0));
  if (scored.length && scored[0].s >= 40) return { kind: 'code', code: scored[0].h.locId, name: scored[0].h.locName };
  const hint = scored.slice(0, 5).map((x) => x.h.locName);
  throw new InputError(
    `No eBird hotspot within ${HOTSPOT_SEARCH_KM} km of campus matches "${t}".${hint.length ? ` Closest: ${hint.join('; ')}.` : ''} Use ebird_hotspots to list them, or pass "campus", "Tompkins County", a hotspot id (L...) or "lat,lng".`,
  );
}

/** eBird's "2026-11-14 07:35" (local time at the location) -> "Sat, Nov 14, 7:35am" without a zone shift. */
function fmtObsTime(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))?/.exec(s || '');
  if (!m) return s || null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 12), +(m[5] || 0)));
  const day = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(d);
  if (!m[4]) return day;
  const h = +m[4];
  return `${day}, ${h % 12 || 12}:${m[5]}${h < 12 ? 'am' : 'pm'}`;
}

/** Collapse repeat reports of one species at one place, keeping the newest. */
function shapeObservations(list, limit) {
  const seen = new Map();
  for (const o of list) {
    const where = o.locationPrivate ? 'a personal location (not a public hotspot)' : o.locName;
    const k = `${o.speciesCode}|${o.locationPrivate ? 'private' : o.locId}`;
    const prev = seen.get(k);
    if (prev) {
      prev.reports += 1;
      continue;
    }
    seen.set(k, {
      species: o.comName,
      code: o.speciesCode,
      count: o.howMany ?? 'present',
      where,
      ...(o.locationPrivate ? {} : { location_id: o.locId }),
      when: fmtObsTime(o.obsDt),
      ...(o.obsValid === false ? { unconfirmed: true } : {}),
      reports: 1,
      _dt: o.obsDt || '',
    });
  }
  const rows = [...seen.values()].sort((a, b) => b._dt.localeCompare(a._dt));
  return rows.slice(0, limit).map(({ _dt, reports, ...r }) => (reports > 1 ? { ...r, reports } : r));
}

async function loadTaxa(codes, key) {
  const out = [];
  for (let i = 0; i < codes.length; i += 150) {
    const chunk = codes.slice(i, i + 150);
    const { data } = await api(`/ref/taxonomy/ebird?fmt=json&species=${chunk.join(',')}`, key, REF_TTL_MS);
    if (Array.isArray(data)) out.push(...data);
  }
  return out;
}

function shapeTaxon(t) {
  return {
    code: t.speciesCode,
    name: t.comName,
    scientific_name: t.sciName,
    category: t.category,
    ...(t.familyComName ? { family: `${t.familyComName} (${t.familySciName})` } : {}),
    ...(t.order ? { order: t.order } : {}),
    ...(t.bandingCodes?.length ? { banding_code: t.bandingCodes[0] } : {}),
    url: `https://ebird.org/species/${t.speciesCode}`,
  };
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export async function ebirdRecentObservations(args = {}, env = {}) {
  const key = keyOf(env);
  const loc = await resolveLocation(args.location, key);
  const back = intArg(args.days_back, 3, 1, 30);
  const limit = intArg(args.limit, 30, 1, 100);
  const radius = intArg(args.radius_km, 5, 1, 50);
  let species = null;
  if (args.species) {
    species = await findSpecies(String(args.species), key);
    if (!species) throw new InputError(`No species matches "${args.species}". Use ebird_species to find the eBird species code.`);
  }
  const kind = species ? `/${species.speciesCode}` : args.notable ? '/notable' : '';
  const q = `back=${back}${args.notable && !species ? '&detail=simple' : ''}`;
  const path =
    loc.kind === 'geo'
      ? `/data/obs/geo/recent${kind}?lat=${loc.lat.toFixed(4)}&lng=${loc.lng.toFixed(4)}&dist=${radius}&${q}`
      : `/data/obs/${loc.code}/recent${kind}?${q}`;
  let data, fetchedAt;
  try {
    ({ data, fetchedAt } = await api(path, key, OBS_TTL_MS));
  } catch (err) {
    if (err instanceof HttpError && (err.status === 400 || err.status === 404)) {
      throw new InputError(`eBird does not know the location "${args.location}". Use "campus", "Tompkins County", a hotspot name near Ithaca, a hotspot id (L...) or "lat,lng".`);
    }
    throw err;
  }
  if (!Array.isArray(data)) throw new Error('Unexpected eBird reply (observations).');
  const rows = shapeObservations(data, limit);
  return {
    location: loc.name,
    ...(loc.kind === 'geo' ? { radius_km: radius } : {}),
    days_back: back,
    kind: species ? `sightings of ${species.comName}` : args.notable ? 'notable (rare or unseasonal) sightings' : 'most recent sighting of each species',
    species_count: new Set(rows.map((r) => r.code)).size,
    observations: rows,
    ...(rows.length ? {} : { note: 'Nothing reported. Widen days_back or radius_km, or try "Tompkins County".' }),
    source: 'eBird (Cornell Lab of Ornithology), https://ebird.org',
    fetched_at: fmtDayTime(fetchedAt),
  };
}

export async function ebirdHotspots(args = {}, env = {}) {
  const key = keyOf(env);
  const radius = intArg(args.radius_km, 10, 1, 50);
  const limit = intArg(args.limit, 20, 1, 60);
  let center = CAMPUS;
  if (args.near && !/^(campus|cornell|ithaca)$/i.test(String(args.near).trim())) {
    const ll = parseLatLng(String(args.near));
    if (!ll) throw new InputError('near must be "campus" or "lat,lng", e.g. "42.48,-76.45".');
    center = { ...ll, name: `${ll.lat}, ${ll.lng}` };
  }
  const { hotspots, fetchedAt } = await loadHotspots(key, center.lat, center.lng, radius);
  let rows = hotspots.map((h) => ({
    name: h.locName,
    id: h.locId,
    km_away: Math.round(distanceKm(center.lat, center.lng, h.lat, h.lng) * 10) / 10,
    species_all_time: h.numSpeciesAllTime ?? null,
    ...(h.latestObsDt ? { latest_checklist: fmtObsTime(h.latestObsDt) } : {}),
    lat: h.lat,
    lng: h.lng,
    url: `https://ebird.org/hotspot/${h.locId}`,
  }));
  if (args.query) {
    rows = rows
      .map((r) => ({ r, s: matchScore(args.query, r.name) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.r);
  } else if (String(args.sort || 'species').toLowerCase().startsWith('dist')) {
    rows.sort((a, b) => a.km_away - b.km_away);
  } else {
    rows.sort((a, b) => (b.species_all_time || 0) - (a.species_all_time || 0));
  }
  return {
    near: center.name,
    radius_km: radius,
    total: rows.length,
    hotspots: rows.slice(0, limit),
    ...(rows.length ? {} : { note: 'No hotspots match. Widen radius_km or drop the query.' }),
    source: 'eBird (Cornell Lab of Ornithology), https://ebird.org/hotspots',
    fetched_at: fmtDayTime(fetchedAt),
  };
}

/** Find one species by eBird code, or by common / scientific name among Tompkins County's species list. */
async function findSpecies(text, key) {
  const t = text.trim();
  if (/^[a-z]{3,6}\d{0,2}$/.test(t)) {
    try {
      const direct = (await loadTaxa([t], key)).filter((x) => x.speciesCode === t);
      if (direct.length) return direct[0];
    } catch (err) {
      if (!(err instanceof HttpError)) throw err;
    }
  }
  const matches = await searchSpecies(t, key);
  return matches[0] || null;
}

async function searchSpecies(text, key) {
  const { data: codes } = await api(`/product/spplist/${COUNTY.code}`, key, REF_TTL_MS);
  if (!Array.isArray(codes)) throw new Error('Unexpected eBird reply (species list).');
  const taxa = await loadTaxa(codes, key);
  const q = normalize(text);
  return taxa
    .map((t) => ({ t, s: Math.max(matchScore(text, t.comName), matchScore(text, t.sciName), t.speciesCode === q ? 100 : 0, (t.bandingCodes || []).some((b) => b.toLowerCase() === q) ? 90 : 0) }))
    .filter((x) => x.s >= 40)
    .sort((a, b) => b.s - a.s || a.t.taxonOrder - b.t.taxonOrder)
    .map((x) => x.t);
}

export async function ebirdSpecies(args = {}, env = {}) {
  const key = keyOf(env);
  const name = String(args.name ?? '').trim();
  if (!name) throw new InputError('name is required: a common name ("cedar waxwing"), scientific name, or eBird species code.');
  let matches = [];
  if (/^[a-z]{3,6}\d{0,2}$/.test(name)) {
    try {
      matches = (await loadTaxa([name], key)).filter((x) => x.speciesCode === name);
    } catch (err) {
      if (!(err instanceof HttpError)) throw err;
    }
  }
  if (!matches.length) matches = await searchSpecies(name, key);
  if (!matches.length) {
    return {
      query: name,
      matches: [],
      note: `No species on eBird's ${COUNTY.name} list matches. Lookup covers species recorded in the county; check the spelling or search https://ebird.org/explore.`,
    };
  }
  const top = matches[0];
  const result = { query: name, matches: matches.slice(0, 8).map(shapeTaxon), scope: `Species ever recorded in ${COUNTY.name}` };
  if (args.include_recent !== false) {
    const back = intArg(args.days_back, 14, 1, 30);
    const { data } = await api(`/data/obs/${COUNTY.code}/recent/${top.speciesCode}?back=${back}`, key, OBS_TTL_MS);
    const rows = Array.isArray(data) ? shapeObservations(data, 8) : [];
    result.recent_in_county = { species: top.comName, days_back: back, sightings: rows.map(({ species, code, ...r }) => r) };
    if (!rows.length) result.recent_in_county.note = `No ${top.comName} reported in ${COUNTY.name} in the last ${back} days.`;
  }
  result.source = 'eBird (Cornell Lab of Ornithology), https://ebird.org';
  return result;
}

export const _internal = { shapeObservations, shapeTaxon, fmtObsTime, parseLatLng, resolveLocation, CAMPUS };
