// Library study rooms and bookable spaces (spaces.library.cornell.edu, the library's LibCal
// site): the room list and the free/busy grid that the booking page shows before anyone signs
// in. Read-only. Nothing here books a room, signs in, or accepts credentials: the booking tool
// only returns a link to the official page, where the person signs in and confirms.

import {
  InputError,
  cachedFetch,
  easternDate,
  easternToEpoch,
  fmtDayTime,
  fmtTime,
  htmlToText,
  intArg,
  matchScore,
  normalize,
  parseTimeOfDay,
  resolveDate,
  truncate,
} from './util.mjs';

const SITE = 'https://spaces.library.cornell.edu';
const LIST_TTL_MS = 6 * 60 * 60 * 1000;
const ROOM_TTL_MS = 6 * 60 * 60 * 1000;
const GRID_TTL_MS = 2 * 60 * 1000;
export const NOT_BOOKED = 'NOT BOOKED. Nothing has been reserved. The person must open the link, sign in with their Cornell NetID and confirm on the library page.';

const unescapeJs = (s) => {
  try {
    return JSON.parse(`"${s}"`);
  } catch {
    return s;
  }
};

/** The room list is embedded in the all-spaces page as `resources.push({...})` blocks. */
function parseRooms(html) {
  const locations = new Map();
  const sel = /<select[^>]*id="lid"[\s\S]*?<\/select>/.exec(html)?.[0] || html;
  for (const m of sel.matchAll(/<option value="(\d+)"[^>]*>\s*([^<]+?)\s*<\/option>/g)) {
    if (+m[1] > 4) locations.set(+m[1], htmlToText(m[2]));
  }
  const rooms = [];
  for (const m of html.matchAll(/resources\.push\(\{([\s\S]*?)\}\);/g)) {
    const b = m[1];
    const str = (k) => {
      const x = new RegExp(`\\b${k}:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(b);
      return x ? unescapeJs(x[1]) : '';
    };
    const num = (k) => {
      const x = new RegExp(`\\b${k}:\\s*(\\d+)`).exec(b);
      return x ? +x[1] : null;
    };
    const eid = num('eid');
    if (!eid) continue;
    const lid = num('lid');
    rooms.push({
      id: eid,
      name: str('title').replace(/\s*\(Capacity \d+\)\s*$/, '').trim(),
      capacity: num('capacity'),
      category: str('grouping').trim(),
      lid,
      gid: num('gid'),
      location: locations.get(lid) || `location ${lid}`,
      path: str('url') || `/space/${eid}`,
    });
  }
  // A room listed under two categories appears twice.
  const seen = new Set();
  return { rooms: rooms.filter((r) => !seen.has(r.id) && seen.add(r.id)), locations };
}

async function loadRooms() {
  const { data: html } = await cachedFetch(`${SITE}/allspaces`, { ttlMs: LIST_TTL_MS, as: 'text', edge: true });
  const parsed = parseRooms(html);
  if (!parsed.rooms.length) throw new Error('Could not read the room list from the library booking page (its layout may have changed)');
  return parsed;
}

const LOCATION_NICKNAMES = [
  [/\b(olin|uris)\b/, /olin/i],
  [/\b(mann)\b/, /mann/i],
  [/\b(ilr|catherwood|ives)\b/, /catherwood/i],
  [/\b(carpenter|engineering)\b/, /carpenter/i],
];

function matchLocation(locations, text) {
  const q = normalize(text);
  if (/^\d+$/.test(q) && locations.has(+q)) return +q;
  for (const [re, name] of LOCATION_NICKNAMES) {
    if (re.test(q)) {
      const hit = [...locations].find(([, n]) => name.test(n));
      if (hit) return hit[0];
    }
  }
  const best = [...locations].map(([lid, n]) => ({ lid, s: matchScore(text, n) })).sort((a, b) => b.s - a.s)[0];
  return best && best.s >= 40 ? best.lid : null;
}

function matchRooms(rooms, text) {
  const t = String(text).trim();
  if (/^\d+$/.test(t)) {
    const byId = rooms.filter((r) => String(r.id) === t);
    if (byId.length) return byId;
  }
  const scored = rooms.map((r) => ({ r, s: Math.max(matchScore(t, r.name), matchScore(t, `${r.location} ${r.name}`) - 5) })).filter((x) => x.s >= 40);
  if (!scored.length) return [];
  const best = Math.max(...scored.map((x) => x.s));
  return scored.filter((x) => x.s === best).map((x) => x.r);
}

function filterRooms(all, locations, args) {
  let rooms = all;
  let lid = null;
  if (args.location) {
    lid = matchLocation(locations, args.location);
    if (!lid) throw new InputError(`No bookable library location matches "${args.location}". Locations: ${[...locations.values()].join(', ')}.`);
    rooms = rooms.filter((r) => r.lid === lid);
  }
  if (args.room) {
    const hit = matchRooms(rooms, args.room);
    if (!hit.length) {
      const near = rooms.map((r) => ({ r, s: matchScore(String(args.room), r.name) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 6).map((x) => x.r.name);
      throw new InputError(`No bookable library room matches "${args.room}".${near.length ? ` Closest: ${near.join('; ')}.` : ''} Use library_rooms_list to see the rooms.`);
    }
    rooms = hit;
  }
  if (args.category) rooms = rooms.filter((r) => matchScore(args.category, r.category) > 0 || normalize(r.category).includes(normalize(args.category)));
  const minCap = intArg(args.min_capacity, 0, 0, 500);
  if (minCap) rooms = rooms.filter((r) => (r.capacity || 0) >= minCap);
  return rooms;
}

const shapeRoom = (r) => ({ room_id: r.id, name: r.name, location: r.location, category: r.category, capacity: r.capacity, page: `${SITE}${r.path.startsWith('/space/') ? r.path : `/space/${r.id}`}` });

/** Description, directions and features from a room's own page. */
function parseRoomPage(html) {
  const region = (cls) => new RegExp(`<div class="${cls}"[^>]*>([\\s\\S]*?)</div>`).exec(html)?.[1] || '';
  const desc = region('s-lc-section-description').replace(/<h2[\s\S]*?<\/h2>/, '');
  // Features are the icon lines at the foot of the description.
  const features = [...desc.matchAll(/<i class="fa [^"]*"[^>]*><\/i>\s*([^<]+?)\s*<br/g)].map((m) => htmlToText(m[1])).filter(Boolean);
  const text = (h) => truncate(htmlToText(h).replace(/(\s*\/\s*)+/g, ' ').trim(), 500);
  const description = text(desc.replace(/<p>\s*<i class="fa [\s\S]*$/, ''));
  const directions = text(region('s-lc-section-directions').replace(/<h2[\s\S]*?<\/h2>/, ''));
  return { description, directions, features };
}

async function roomDetails(room) {
  try {
    const { data: html } = await cachedFetch(`${SITE}/space/${room.id}`, { ttlMs: ROOM_TTL_MS, as: 'text', edge: true });
    return parseRoomPage(html);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Availability grid
// ---------------------------------------------------------------------------

/** "2026-11-16 08:30:00" (Ithaca wall clock) -> epoch ms. */
function slotTime(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/.exec(s || '');
  return m ? easternToEpoch(+m[1], +m[2], +m[3], +m[4], +m[5]) : null;
}

/** Grid slots -> Map(roomId -> {free: [[start,end]...], busy: [[start,end]...]}), contiguous slots merged. */
function parseGrid(json) {
  const out = new Map();
  for (const s of json?.slots || []) {
    const a = slotTime(s.start);
    const b = slotTime(s.end);
    if (a == null || b == null) continue;
    if (!out.has(s.itemId)) out.set(s.itemId, { free: [], busy: [] });
    // A slot with no class is open for booking; any class (checked out, padding, unavailable) is not.
    const list = s.className ? out.get(s.itemId).busy : out.get(s.itemId).free;
    const last = list[list.length - 1];
    if (last && last[1] === a) last[1] = b;
    else list.push([a, b]);
  }
  for (const v of out.values()) {
    v.free.sort((x, y) => x[0] - y[0]);
    v.busy.sort((x, y) => x[0] - y[0]);
  }
  return out;
}

async function loadGrid(lid, day) {
  const next = easternDate(easternToEpoch(day.y, day.m, day.d, 12) + 86400000);
  const body = `lid=${lid}&gid=0&eid=-1&seat=0&seatId=0&zone=0&start=${day.iso}&end=${next}&pageIndex=0&pageSize=100`;
  // The endpoint is the one the public booking grid calls; it only answers requests that name that page.
  const { data, fetchedAt } = await cachedFetch(`${SITE}/spaces/availability/grid`, {
    ttlMs: GRID_TTL_MS,
    body,
    headers: { referer: `${SITE}/allspaces`, 'x-requested-with': 'XMLHttpRequest' },
  });
  return { grid: parseGrid(data), fetchedAt };
}

const span = ([a, b]) => `${fmtTime(a)}-${fmtTime(b)}`;

/** Optional {start, duration_minutes} on a day -> [startMs, endMs] or null. */
function wanted(args, day) {
  if (!args.start) return null;
  const t = parseTimeOfDay(args.start);
  if (!t) throw new InputError(`Could not understand start "${args.start}". Try "2pm" or "14:00".`);
  const minutes = intArg(args.duration_minutes, 60, 15, 12 * 60);
  const a = easternToEpoch(day.y, day.m, day.d, t.h, t.m);
  return [a, a + minutes * 60000];
}

const covers = (free, want) => free.some(([a, b]) => a <= want[0] && want[1] <= b);

export async function libraryRoomsList(args = {}) {
  const { rooms: all, locations } = await loadRooms();
  const rooms = filterRooms(all, locations, args);
  const single = rooms.length === 1 ? await roomDetails(rooms[0]) : null;
  return {
    count: rooms.length,
    locations: [...locations.values()],
    rooms: rooms.map((r) => ({
      ...shapeRoom(r),
      ...(single?.description ? { description: single.description } : {}),
      ...(single?.directions && single.directions !== single.description ? { directions: single.directions } : {}),
      ...(single?.features?.length ? { features: single.features } : {}),
    })),
    ...(rooms.length ? {} : { note: 'No rooms match. Drop a filter; library_rooms_list with no arguments lists every bookable room.' }),
    booking: 'Rooms are reserved on the library site with a Cornell NetID. Use library_rooms_availability for free times and library_room_booking_link for the link; this server cannot book.',
    source: `${SITE}/allspaces`,
  };
}

export async function libraryRoomsAvailability(args = {}, nowMs = Date.now()) {
  const day = resolveDate(args.date, nowMs);
  if (day.iso < easternDate(nowMs)) throw new InputError('Availability is only shown for today and future dates.');
  const { rooms: all, locations } = await loadRooms();
  const rooms = filterRooms(all, locations, args);
  if (!rooms.length) return { date: day.iso, rooms: [], note: 'No rooms match those filters. Use library_rooms_list to see the rooms.' };
  const want = wanted(args, day);
  const lids = [...new Set(rooms.map((r) => r.lid))];
  const grids = await Promise.all(lids.map((lid) => loadGrid(lid, day)));
  const byLid = new Map(lids.map((lid, i) => [lid, grids[i].grid]));
  const isToday = day.iso === easternDate(nowMs);
  const rows = rooms.map((r) => {
    const g = byLid.get(r.lid)?.get(r.id);
    // Times already past cannot be booked.
    const free = (g?.free || []).map(([a, b]) => [isToday ? Math.max(a, nowMs - 15 * 60000) : a, b]).filter(([a, b]) => b - a >= 15 * 60000);
    return { r, free, listed: !!g };
  });
  const shown = want ? rows.filter((x) => covers(x.free, want)) : rows;
  const limit = intArg(args.limit, 25, 1, 70);
  shown.sort((a, b) => (b.free.length > 0) - (a.free.length > 0) || a.r.location.localeCompare(b.r.location) || a.r.name.localeCompare(b.r.name, 'en', { numeric: true }));
  const anyListed = rows.some((x) => x.listed);
  return {
    date: day.iso,
    ...(isToday ? { as_of: fmtDayTime(nowMs) } : {}),
    ...(want ? { wanted: span(want) } : {}),
    count: shown.length,
    rooms: shown.slice(0, limit).map(({ r, free, listed }) => ({
      room_id: r.id,
      name: r.name,
      location: r.location,
      capacity: r.capacity,
      ...(want ? { free_for_wanted_time: true } : {}),
      free: free.map(span),
      ...(free.length ? {} : { note: listed ? 'Fully booked or closed on this date.' : 'No bookable times are published for this date.' }),
    })),
    ...(shown.length > limit ? { not_shown: shown.length - limit } : {}),
    ...(want && !shown.length ? { note: `No matching room is free for ${span(want)}. Call again without start to see each room's free times.` } : {}),
    ...(!anyListed ? { warning: 'The booking site lists no times for this date: it may be past the booking window (rooms open for booking only some days ahead) or the library may be closed.' } : {}),
    reminder: 'Availability is live but changes quickly. Nothing is reserved until the person books on the library site: use library_room_booking_link.',
    source: `${SITE}/allspaces`,
    fetched_at: fmtDayTime(grids[0].fetchedAt),
  };
}

export async function libraryRoomBookingLink(args = {}, nowMs = Date.now()) {
  if (!String(args.room ?? '').trim()) throw new InputError('room is required: a room name or room_id from library_rooms_list, e.g. "Olin 302".');
  const day = resolveDate(args.date, nowMs);
  if (day.iso < easternDate(nowMs)) throw new InputError('Pick today or a future date.');
  const { rooms: all, locations } = await loadRooms();
  const matches = filterRooms(all, locations, { room: args.room, location: args.location });
  if (matches.length > 1) {
    throw new InputError(`"${args.room}" matches several rooms: ${matches.slice(0, 8).map((r) => `${r.name} (${r.location}, room_id ${r.id})`).join('; ')}. Pass the room_id.`);
  }
  const room = matches[0];
  const want = wanted(args, day);
  let check = null;
  let free = [];
  try {
    const { grid } = await loadGrid(room.lid, day);
    free = grid.get(room.id)?.free || [];
    if (want) check = covers(free, want);
  } catch {
    check = null;
  }
  const details = await roomDetails(room);
  const link = `${SITE}/space/${room.id}?date=${day.iso}`;
  const whenText = want ? `${day.iso}, ${span(want)}` : day.iso;
  return {
    status: NOT_BOOKED,
    link,
    link_opens: `The library's booking page for ${room.name} with ${day.iso} already selected. The site cannot pre-fill the time.`,
    request: {
      room: room.name,
      room_id: room.id,
      location: room.location,
      capacity: room.capacity,
      date: day.iso,
      ...(want ? { time: span(want) } : {}),
    },
    ...(want
      ? {
          availability_check:
            check === true
              ? `Free for ${span(want)} when checked just now; it can be taken at any moment.`
              : check === false
                ? `NOT free for the whole of ${span(want)}. Free times that day: ${free.length ? free.map(span).join(', ') : 'none'}.`
                : 'Availability could not be checked; the booking page will show it.',
        }
      : { free_times: free.map(span) }),
    steps: [
      `Open the link (${room.name}, ${day.iso}).`,
      want ? `On the availability grid, click the ${fmtTime(want[0])} slot and choose ${fmtTime(want[1])} as the end time.` : 'On the availability grid, click the start time you want and choose the end time.',
      'Press "Submit Times".',
      'Sign in with your Cornell NetID (and Duo) when asked.',
      'Complete the booking form and submit it. The room is reserved only once the library site shows or emails a confirmation; follow any instruction in that email.',
    ],
    summary: `Prepared, not booked: ${room.name} (${room.location}, capacity ${room.capacity}) on ${whenText}. Open the link and confirm to reserve it.`,
    ...(details?.description ? { room_notes: details.description } : {}),
    source: SITE,
  };
}

export const _internal = { parseRooms, parseGrid, parseRoomPage, matchLocation, matchRooms, covers };
