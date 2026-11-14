// Cornell events calendar (events.cornell.edu, a Localist site): its public JSON API, version 2.
// robots.txt asks crawlers for one request a second; calls here are per question and cached.

import {
  HttpError,
  InputError,
  cachedFetch,
  easternDate,
  easternParts,
  easternToEpoch,
  fmtDayTime,
  fmtTime,
  intArg,
  matchScore,
  resolveDate,
  truncate,
} from './util.mjs';

const BASE = 'https://events.cornell.edu/api/2';
const EVENTS_TTL_MS = 10 * 60 * 1000;
const FILTERS_TTL_MS = 12 * 60 * 60 * 1000;
const PLACES_TTL_MS = 60 * 60 * 1000;
const MAX_RANGE_DAYS = 370;

const KINDS = { type: 'event_types', department: 'departments', theme: 'event_university_themes' };

async function loadFilters() {
  const { data } = await cachedFetch(`${BASE}/events/filters`, { ttlMs: FILTERS_TTL_MS, edge: true });
  return data || {};
}

/** A filter name (or numeric id) -> {id, name}; throws InputError with suggestions otherwise. */
function resolveFilter(filters, kind, text) {
  const all = filters[KINDS[kind]] || [];
  const t = String(text).trim();
  if (/^\d+$/.test(t)) {
    const byId = all.find((f) => String(f.id) === t);
    if (byId) return byId;
  }
  const scored = all.map((f) => ({ f, s: matchScore(t, f.name) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s || a.f.name.length - b.f.name.length);
  if (scored.length && scored[0].s >= 40) return scored[0].f;
  const hint = scored.slice(0, 6).map((x) => x.f.name);
  throw new InputError(
    `No event ${kind} matches "${t}".${hint.length ? ` Closest: ${hint.join('; ')}.` : ''} Use events_categories to list the ${kind}s.`,
  );
}

const GENERIC_PLACE_WORDS = new Set(['hall', 'building', 'center', 'centre', 'library', 'the', 'of', 'room', 'auditorium', 'field', 'house', 'cornell']);

async function searchPlaces(text) {
  const { data } = await cachedFetch(`${BASE}/places/search?search=${encodeURIComponent(text)}&pp=20`, { ttlMs: PLACES_TTL_MS, edge: true });
  return (data?.places || []).map((p) => p.place).filter(Boolean);
}

async function resolvePlace(text) {
  const t = String(text).trim();
  if (/^\d+$/.test(t)) return { id: Number(t), name: `place ${t}` };
  const rank = (places) => places.map((p) => ({ p, s: matchScore(t, p.name) })).sort((a, b) => b.s - a.s || a.p.name.length - b.p.name.length);
  let ranked = rank(await searchPlaces(t));
  if (!ranked.length || ranked[0].s < 60) {
    // The calendar's place search matches any word, so "Bailey Hall" drowns in halls: retry on the distinctive word.
    const word = t.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !GENERIC_PLACE_WORDS.has(w)).sort((a, b) => b.length - a.length)[0];
    if (word && word !== t.toLowerCase()) ranked = rank([...ranked.map((x) => x.p), ...(await searchPlaces(word))]);
  }
  if (ranked.length && ranked[0].s >= 40) return { id: ranked[0].p.id, name: ranked[0].p.name };
  const hint = ranked.filter((x) => x.s > 0).slice(0, 5).map((x) => x.p.name);
  throw new InputError(
    `No place on the events calendar matches "${t}".${hint.length ? ` Closest: ${hint.join('; ')}.` : ''} Try the building name, e.g. "Bailey Hall", or search by keyword instead.`,
  );
}

function when(inst) {
  const start = Date.parse(inst.start);
  const end = inst.end ? Date.parse(inst.end) : null;
  const dayOnly = fmtDayTime(start).replace(/, [^,]*$/, '');
  if (inst.all_day) return { start: `${dayOnly} (all day)`, date: easternDate(start) };
  // Some entries carry a midnight placeholder instead of a start time.
  if (!end && fmtTime(start) === '12:00am') return { start: `${dayOnly} (time not listed)`, date: easternDate(start) };
  return {
    start: fmtDayTime(start),
    ...(end ? { end: easternDate(end) === easternDate(start) ? fmtTime(end) : fmtDayTime(end) } : {}),
    date: easternDate(start),
  };
}

const filterNames = (ev, key) => (ev.filters?.[key] || []).map((f) => f.name);

function place(ev) {
  const parts = [ev.location_name || ev.location, ev.room_number].filter(Boolean).map((x) => String(x).replace(/\s+/g, ' ').trim());
  return parts.length ? truncate(parts.join(', '), 140) : ev.experience === 'virtual' ? 'Online' : null;
}

function shape(ev, inst, descMax) {
  const types = filterNames(ev, 'event_types');
  const depts = filterNames(ev, 'departments');
  return {
    id: String(ev.id),
    title: ev.title,
    ...when(inst),
    ...(place(ev) ? { where: place(ev) } : {}),
    ...(ev.experience && ev.experience !== 'inperson' ? { format: ev.experience } : {}),
    ...(types.length ? { types } : {}),
    ...(depts.length ? { departments: depts.slice(0, 3) } : {}),
    ...(ev.ticket_cost ? { cost: truncate(ev.ticket_cost, 80) } : ev.free ? { cost: 'free' } : {}),
    ...(ev.description_text && descMax ? { description: truncate(ev.description_text, descMax) } : {}),
    url: ev.localist_url,
  };
}

export async function eventsSearch(args = {}, nowMs = Date.now()) {
  const start = resolveDate(args.start, nowMs);
  let endIso;
  if (args.end) {
    const e = resolveDate(args.end, nowMs);
    if (e.iso < start.iso) throw new InputError(`end (${e.iso}) is before start (${start.iso}).`);
    // The API's end date is exclusive; ours is inclusive.
    endIso = easternDate(easternToEpoch(e.y, e.m, e.d, 12) + 86400000);
  } else {
    const days = intArg(args.days, 7, 1, MAX_RANGE_DAYS);
    endIso = easternDate(easternToEpoch(start.y, start.m, start.d, 12) + days * 86400000);
  }
  const spanDays = Math.round((Date.parse(endIso) - Date.parse(start.iso)) / 86400000);
  if (spanDays > MAX_RANGE_DAYS) throw new InputError(`The date range is too long (${spanDays} days); the calendar allows about a year.`);

  const limit = intArg(args.limit, 15, 1, 50);
  const page = intArg(args.page, 1, 1, 500);
  const params = new URLSearchParams({ start: start.iso, end: endIso, pp: String(limit), page: String(page), distinct: 'true', sort: 'date' });
  const applied = {};
  if (args.type || args.department || args.theme) {
    const filters = await loadFilters();
    for (const kind of Object.keys(KINDS)) {
      if (!args[kind]) continue;
      const f = resolveFilter(filters, kind, args[kind]);
      params.append('type[]', String(f.id));
      applied[kind] = f.name;
    }
  }
  if (args.place) {
    const p = await resolvePlace(args.place);
    params.set('venue_id', String(p.id));
    applied.place = p.name;
  }
  const query = String(args.query ?? '').trim();
  let path = '/events';
  if (query) {
    path = '/events/search';
    params.set('search', query);
  }
  const { data, fetchedAt } = await cachedFetch(`${BASE}${path}?${params}`, { ttlMs: EVENTS_TTL_MS, edge: true });
  const today = easternDate(nowMs);
  const events = (data?.events || [])
    .map((e) => e.event)
    .filter(Boolean)
    .map((ev) => {
      const insts = (ev.event_instances || []).map((i) => i.event_instance).filter(Boolean);
      const inst = insts.find((i) => easternDate(Date.parse(i.start)) >= start.iso) || insts[0];
      return inst ? shape(ev, inst, 160) : null;
    })
    .filter(Boolean);
  const pg = data?.page || {};
  return {
    from: start.iso,
    through: easternDate(Date.parse(`${endIso}T12:00:00Z`) - 86400000),
    ...(query ? { query } : {}),
    ...(Object.keys(applied).length ? { filters: applied } : {}),
    total: pg.total_items ?? events.length,
    page: pg.current ?? page,
    pages: pg.total ?? 1,
    events,
    ...(events.length ? {} : { note: 'No events match. Widen the dates (days or end) or drop a filter.' }),
    ...(start.iso === today ? { as_of: fmtDayTime(nowMs) } : {}),
    source: 'https://events.cornell.edu',
    fetched_at: fmtDayTime(fetchedAt),
  };
}

export async function eventsDetail(args = {}, nowMs = Date.now()) {
  const id = String(args.id ?? '').trim();
  if (!/^\d+$/.test(id)) throw new InputError('id must be the numeric event id from events_search.');
  let data;
  try {
    ({ data } = await cachedFetch(`${BASE}/events/${id}`, { ttlMs: EVENTS_TTL_MS, edge: true }));
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) throw new InputError(`No event with id ${id}. Use events_search to find it.`);
    throw err;
  }
  const ev = data?.event;
  if (!ev) throw new Error('Unexpected events reply (no event).');
  const everyInst = (ev.event_instances || []).map((i) => i.event_instance).filter(Boolean);
  // Drop a midnight placeholder when the same day also has a real start time.
  const placeholder = (i) => !i.all_day && !i.end && fmtTime(Date.parse(i.start)) === '12:00am';
  const insts = everyInst.filter(
    (i) => !placeholder(i) || !everyInst.some((o) => o !== i && !placeholder(o) && easternDate(Date.parse(o.start)) === easternDate(Date.parse(i.start))),
  );
  const upcoming = insts.filter((i) => Date.parse(i.end || i.start) >= nowMs - 3600000);
  const shown = (upcoming.length ? upcoming : insts.slice(-1)).slice(0, 10);
  const base = shape(ev, shown[0] || insts[0] || { start: ev.first_date, all_day: true }, 2500);
  const custom = Object.entries(ev.custom_fields || {})
    .filter(([k, v]) => typeof v === 'string' && v.trim() && !/email|phone/i.test(k))
    .slice(0, 6)
    .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${truncate(v, 160)}`);
  return {
    ...base,
    ...(ev.address ? { address: ev.address } : {}),
    ...(shown.length > 1 ? { dates: shown.map((i) => when(i).start) } : {}),
    ...(upcoming.length > shown.length ? { more_dates: upcoming.length - shown.length } : {}),
    ...(upcoming.length ? {} : { status: 'This event is over.' }),
    ...(ev.stream_url ? { stream_url: ev.stream_url } : {}),
    ...(ev.ticket_url ? { ticket_url: ev.ticket_url } : {}),
    ...(ev.url ? { website: ev.url } : {}),
    ...(filterNames(ev, 'event_university_themes').length ? { themes: filterNames(ev, 'event_university_themes') } : {}),
    ...(ev.tags?.length ? { tags: ev.tags.slice(0, 10) } : {}),
    ...(custom.length ? { details: custom } : {}),
  };
}

export async function eventsCategories(args = {}) {
  const kind = String(args.kind || 'type').toLowerCase().replace(/s$/, '');
  if (!KINDS[kind]) throw new InputError('kind must be "type", "department" or "theme".');
  const filters = await loadFilters();
  let items = filters[KINDS[kind]] || [];
  if (args.query) {
    items = items
      .map((f) => ({ f, s: matchScore(args.query, f.name) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.f);
  } else {
    items = [...items].sort((a, b) => a.name.localeCompare(b.name));
  }
  return {
    kind,
    count: items.length,
    names: items.map((f) => f.name),
    use: `Pass one of these names as the ${kind} argument of events_search.`,
  };
}

export const _internal = { shape, when, resolveFilter, easternParts };
