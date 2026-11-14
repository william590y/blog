// Campus rooms in 25Live (Scheduling@Cornell, 25live.collegenet.com/pro/cornell): classrooms,
// meeting rooms and event spaces. Cornell's 25Live lets anyone browse spaces and their calendars
// without signing in; these tools read that same anonymous view. Requesting a space needs a
// Cornell sign-in and approval by the space's scheduler, so the booking tool only returns a link.

import { HttpError, InputError, cachedFetch, easternDate, easternToEpoch, fmtDayTime, fmtTime, intArg, parseTimeOfDay, resolveDate, truncate } from './util.mjs';

const API = 'https://25live.collegenet.com/25live/data/cornell/run';
const PRO = 'https://25live.collegenet.com/pro/cornell';
const SEARCH_TTL_MS = 6 * 60 * 60 * 1000;
const SPACE_TTL_MS = 24 * 60 * 60 * 1000;
const AVAIL_TTL_MS = 5 * 60 * 1000;
export const NOT_REQUESTED = 'NOT BOOKED. Nothing has been requested or reserved. The person must open 25Live, sign in with their Cornell NetID and submit the request themselves; the space\'s scheduler then approves or declines it.';

const arr = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]);
const DAY_START_H = 7;
const DAY_END_H = 23;

async function searchSpaces(text) {
  const { data } = await cachedFetch(`${API}/spaces.json?scope=list&name=${encodeURIComponent(text)}&page_size=40&paginate`, { ttlMs: SEARCH_TTL_MS, edge: true });
  return arr(data?.list?.item).map((i) => ({ id: i.id, code: i.name }));
}

function shapeSpace(sp) {
  const cats = arr(sp.category).map((c) => c.category_name).filter((n) => n && !/^(COVID|Campus - )/.test(n));
  return {
    space_id: sp.space_id,
    code: sp.space_name,
    name: sp.formal_name || sp.space_name,
    capacity: sp.max_capacity ?? null,
    ...(sp.partition_name ? { building: sp.partition_name } : {}),
    ...(cats.length ? { categories: cats.slice(0, 6) } : {}),
    ...(arr(sp.feature).length ? { features: arr(sp.feature).map((f) => f.feature_name).filter(Boolean).slice(0, 14) } : {}),
    ...(sp.comments ? { comments: truncate(String(sp.comments), 300) } : {}),
    page: `${PRO}#!/home/location/${sp.space_id}/details`,
  };
}

async function loadSpace(id) {
  try {
    const { data } = await cachedFetch(`${API}/space.json?space_id=${id}&include=features+categories`, { ttlMs: SPACE_TTL_MS, edge: true });
    const sp = data?.spaces?.space;
    if (!sp || Array.isArray(sp) || !sp.space_id) return null;
    // Respect the scheduling office's own marking for spaces not meant for general requests.
    if (arr(sp.category).some((c) => /hidden from general users/i.test(c.category_name || ''))) return null;
    return sp;
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) return null;
    throw err;
  }
}

/** A space argument (25Live id, room code such as GTSG01, or words such as "Gates G01") -> space records. */
async function resolveSpaces(text, max = 6) {
  const t = String(text ?? '').trim();
  if (!t) throw new InputError('Give a space: a name such as "Gates G01" or "Klarman auditorium", a room code such as GTSG01, or a space_id from campus_rooms_search.');
  if (/^\d+$/.test(t)) {
    const sp = await loadSpace(t);
    if (sp) return [sp];
  }
  let hits = await searchSpaces(t);
  const words = t.split(/\s+/).filter((w) => w.length > 1 && !/^(hall|room|the)$/i.test(w));
  if (!hits.length && words.length > 1) {
    // The search matches one phrase; fall back to the building word and filter by the rest below.
    hits = await searchSpaces(words[0]);
  }
  const spaces = (await Promise.all(hits.slice(0, 14).map((h) => loadSpace(h.id)))).filter(Boolean);
  const score = (sp) => {
    const hay = `${sp.space_name} ${sp.formal_name}`.toLowerCase();
    return words.filter((w) => hay.includes(w.toLowerCase())).length + (sp.space_name.toLowerCase() === t.toLowerCase().replace(/\s+/g, '') ? 5 : 0);
  };
  const ranked = spaces.map((sp) => ({ sp, s: score(sp) })).sort((a, b) => b.s - a.s);
  const best = ranked[0]?.s ?? 0;
  const top = ranked.filter((x) => x.s === best && best > 0).map((x) => x.sp);
  return (top.length ? top : ranked.map((x) => x.sp)).slice(0, max);
}

const hourToEpoch = (day, h) => easternToEpoch(day.y, day.m, day.d, 0, 0) + Math.round(h * 60) * 60000;
const span = ([a, b]) => `${fmtTime(a)}-${fmtTime(b)}`;

/** Availability payload for one space and day -> merged busy blocks with the names of what is scheduled. */
function parseBusy(json, day) {
  const items = arr(json?.subjects).flatMap((s) => arr(s.items));
  const blocks = [];
  for (const it of items) {
    // Hours of the day as decimals; the feed mixes numbers and numeric strings.
    const from = Number(it.start);
    const to = Number(it.end);
    if (!Number.isFinite(from) || !Number.isFinite(to) || it.start === '' || it.end === '' || to <= from) continue;
    const a = hourToEpoch(day, from);
    const b = hourToEpoch(day, to);
    const same = blocks.find((x) => x.start === a && x.end === b);
    const name = String(it.itemName || '').trim();
    if (same) {
      if (name && !same.names.includes(name)) same.names.push(name);
    } else blocks.push({ start: a, end: b, names: name ? [name] : [] });
  }
  return blocks.sort((x, y) => x.start - y.start);
}

function freeGaps(blocks, day, nowMs) {
  let cursor = hourToEpoch(day, DAY_START_H);
  const end = hourToEpoch(day, DAY_END_H);
  if (day.iso === easternDate(nowMs)) cursor = Math.max(cursor, nowMs);
  const gaps = [];
  for (const b of blocks) {
    if (b.start - cursor >= 15 * 60000) gaps.push([cursor, Math.min(b.start, end)]);
    cursor = Math.max(cursor, b.end);
    if (cursor >= end) break;
  }
  if (end - cursor >= 15 * 60000) gaps.push([cursor, end]);
  return gaps.filter(([a, b]) => b > a);
}

async function loadBusy(id, day) {
  const q = `obj_cache_accl=0&start_dt=${day.iso}T00:00:00&comptype=availability&compsubject=location&page_size=5&space_id=${id}&include=closed+blackouts+pending+related+empty`;
  const { data, fetchedAt } = await cachedFetch(`${API}/availability/availabilitydata.json?${q}`, { ttlMs: AVAIL_TTL_MS, edge: true });
  if (!data || !Array.isArray(data.subjects)) throw new Error('Unexpected 25Live reply (availability)');
  return { blocks: parseBusy(data, day), fetchedAt };
}

function wanted(args, day) {
  if (!args.start) return null;
  const t = parseTimeOfDay(args.start);
  if (!t) throw new InputError(`Could not understand start "${args.start}". Try "2pm" or "14:00".`);
  const minutes = intArg(args.duration_minutes, 60, 15, 16 * 60);
  const a = easternToEpoch(day.y, day.m, day.d, t.h, t.m);
  return [a, a + minutes * 60000];
}
const clashes = (blocks, want) => blocks.filter((b) => b.start < want[1] && want[0] < b.end);

export async function campusRoomsSearch(args = {}) {
  const spaces = await resolveSpaces(args.query, intArg(args.limit, 8, 1, 14));
  const minCap = intArg(args.min_capacity, 0, 0, 5000);
  const rows = spaces.map(shapeSpace).filter((s) => !minCap || (s.capacity || 0) >= minCap);
  return {
    count: rows.length,
    spaces: rows,
    ...(rows.length ? {} : { note: 'No 25Live space matches. Try the building name ("Gates", "Klarman", "Willard Straight") or a room code such as GTSG01.' }),
    booking: 'Spaces are requested in 25Live with a Cornell NetID and approved by each space\'s scheduler. Use campus_rooms_availability for the calendar and campus_room_booking_link for the link; this server cannot request or book.',
    source: `${PRO} (Scheduling@Cornell, public view)`,
  };
}

export async function campusRoomsAvailability(args = {}, nowMs = Date.now()) {
  const day = resolveDate(args.date, nowMs);
  const spaces = await resolveSpaces(args.space, 4);
  if (!spaces.length) throw new InputError(`No 25Live space matches "${args.space}". Use campus_rooms_search to find it.`);
  const want = wanted(args, day);
  const results = await Promise.all(
    spaces.map(async (sp) => {
      const { blocks, fetchedAt } = await loadBusy(sp.space_id, day);
      const hits = want ? clashes(blocks, want) : null;
      return {
        fetchedAt,
        row: {
          space_id: sp.space_id,
          code: sp.space_name,
          name: sp.formal_name || sp.space_name,
          capacity: sp.max_capacity ?? null,
          ...(want ? { free_for_wanted_time: hits.length === 0, ...(hits.length ? { conflicts: hits.map((b) => `${span([b.start, b.end])} ${truncate(b.names.join(' / '), 80)}`) } : {}) } : {}),
          scheduled: blocks.slice(0, 30).map((b) => ({ time: span([b.start, b.end]), what: truncate(b.names.join(' / '), 120) || 'in use' })),
          unscheduled_between_7am_and_11pm: freeGaps(blocks, day, nowMs).map(span),
        },
      };
    }),
  );
  return {
    date: day.iso,
    ...(want ? { wanted: span(want) } : {}),
    spaces: results.map((r) => r.row),
    ...(spaces.length > 1 ? { note: `"${args.space}" matches ${spaces.length} spaces; pass a space_id for just one.` } : {}),
    reminder: 'An unscheduled time is not a guarantee: buildings close, some rooms are restricted to a department, and every request is reviewed by the space\'s scheduler. Nothing is requested until the person does it in 25Live: use campus_room_booking_link.',
    source: `${PRO} (Scheduling@Cornell, public view)`,
    fetched_at: fmtDayTime(results[0].fetchedAt),
  };
}

export async function campusRoomBookingLink(args = {}, nowMs = Date.now()) {
  const day = resolveDate(args.date, nowMs);
  if (day.iso < easternDate(nowMs)) throw new InputError('Pick today or a future date.');
  const spaces = await resolveSpaces(args.space, 6);
  if (!spaces.length) throw new InputError(`No 25Live space matches "${args.space}". Use campus_rooms_search to find it.`);
  if (spaces.length > 1) {
    throw new InputError(`"${args.space}" matches several spaces: ${spaces.map((s) => `${s.formal_name || s.space_name} (space_id ${s.space_id})`).join('; ')}. Pass the space_id.`);
  }
  const sp = spaces[0];
  const want = wanted(args, day);
  let check = null;
  if (want) {
    try {
      const { blocks } = await loadBusy(sp.space_id, day);
      const hits = clashes(blocks, want);
      check = hits.length
        ? `NOT free for ${span(want)}: ${hits.map((b) => `${span([b.start, b.end])} ${truncate(b.names.join(' / '), 60)}`).join('; ')}.`
        : `Nothing is scheduled there for ${span(want)} as of now; the scheduler still decides.`;
    } catch {
      check = 'The calendar could not be checked; 25Live will show it.';
    }
  }
  const name = sp.formal_name || sp.space_name;
  const whenText = want ? `${day.iso}, ${span(want)}` : day.iso;
  return {
    status: NOT_REQUESTED,
    link: `${PRO}#!/home/location/${sp.space_id}/details`,
    link_opens: `The 25Live page for ${name}. 25Live does not accept a pre-filled date or time in a link, so they are entered on the event form.`,
    request: { space: name, code: sp.space_name, space_id: sp.space_id, capacity: sp.max_capacity ?? null, date: day.iso, ...(want ? { time: span(want) } : {}) },
    ...(check ? { availability_check: check } : {}),
    steps: [
      'Open the link and press "Sign In" (Cornell NetID and Duo).',
      `On the location's page choose "Reserve This Location" (or open the Event Form and add ${sp.space_name} as the location).`,
      `Enter the event name, type, expected head count and the date and time (${whenText}).`,
      'Save the request. It goes to the scheduler for that location (allow up to 5 business days); the space is yours only when the scheduler confirms it.',
    ],
    summary: `Prepared, not requested: ${name} (capacity ${sp.max_capacity ?? 'unknown'}) on ${whenText}. Open 25Live, sign in and submit the request to ask for it.`,
    who_can_request: 'Anyone with a Cornell NetID can sign in to Scheduling@Cornell (25Live) and submit a request. The scheduler for the location reviews it; the site says to allow up to 5 business days, longer if the event needs further review. See https://scheduling.cornell.edu.',
    source: `${PRO} (Scheduling@Cornell)`,
  };
}

export const _internal = { parseBusy, freeGaps, shapeSpace, clashes };
