// Cornell Dining: hours, menus and payment info from the public Cornell Dining Now feed.
// Feed shape: { status, data: { eateries: [ { name, campusArea, eateryTypes, payMethods,
//   operatingHours: [ { date, status, events: [ { descr, startTimestamp, endTimestamp,
//   start, end, calSummary, menu: [ { category, items: [ { item, healthy } ] } ] } ] } ],
//   diningItems: [ { item, category, healthy } ], coordinates, location, ... } ] } }

import {
  InputError,
  cachedFetch,
  easternDate,
  easternToEpoch,
  fmtTime,
  fmtDayTime,
  matchScore,
  minutesBetween,
  normalize,
  resolveDate,
  resolveInstant,
} from './util.mjs';

// The feed moved from now.dining.cornell.edu (which now serves the web app) to admin-now (2026-10).
const DINING_URL = 'https://admin-now.dining.cornell.edu/api/1.0/dining/eateries.json';
const DINING_TTL_MS = 10 * 60 * 1000;

// Nicknames students actually use → text to look for in the official name.
const ALIASES = {
  okies: 'okenshields',
  oken: 'okenshields',
  rpme: 'robert purcell',
  rpcc: 'robert purcell',
  rpu: 'robert purcell',
  appel: 'north star',
  'north star': 'north star',
  bethe: 'bethe',
  jansens: 'bethe',
  '104': '104west',
  '104 west': '104west',
  libe: 'libe',
  trillium: 'trillium',
  mattins: 'mattin',
  marthas: 'martha',
  bus: 'bus stop',
  'straight': 'okenshields',
};

const TYPE_SYNONYMS = {
  'dining hall': 'dining room',
  'dining halls': 'dining room',
  hall: 'dining room',
  'all you can eat': 'dining room',
  'all-you-can-eat': 'dining room',
  coffee: 'coffee',
  cafe: 'cafe',
  cafes: 'cafe',
  convenience: 'convenience',
  market: 'convenience',
  store: 'convenience',
};

// ---------------------------------------------------------------------------
// Loading + normalizing the feed
// ---------------------------------------------------------------------------

function toMs(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > 1e12 ? n : n * 1000;
}

function fromDateAndText(dateIso, text) {
  const m = /^(\d{1,2}):(\d{2})\s*(am|pm)$/i.exec(String(text || '').trim());
  if (!dateIso || !m) return null;
  let h = +m[1] % 12;
  if (m[3].toLowerCase() === 'pm') h += 12;
  const [y, mo, d] = dateIso.split('-').map(Number);
  return easternToEpoch(y, mo, d, h, +m[2]);
}

function normalizeMenu(menu) {
  if (!Array.isArray(menu) || menu.length === 0) return [];
  // Some eateries send a flat list of items instead of categories.
  if (menu.every((x) => x && x.item !== undefined && x.items === undefined)) {
    return [{ category: 'Menu', items: menu.map((i) => ({ item: i.item, healthy: !!i.healthy })) }];
  }
  return menu
    .filter((c) => Array.isArray(c?.items))
    .sort((a, b) => (a.sortIdx ?? 0) - (b.sortIdx ?? 0))
    .map((c) => ({
      category: c.category || 'Menu',
      items: c.items
        .slice()
        .sort((a, b) => (a.sortIdx ?? 0) - (b.sortIdx ?? 0))
        .map((i) => ({ item: i.item, healthy: !!i.healthy })),
    }));
}

function normalizeEatery(e) {
  const days = (e.operatingHours || []).map((d) => ({
    date: d.date,
    status: d.status || null,
    events: (d.events || [])
      .map((ev) => {
        let start = toMs(ev.startTimestamp) ?? fromDateAndText(d.date, ev.start);
        let end = toMs(ev.endTimestamp) ?? fromDateAndText(d.date, ev.end);
        if (start && end && end <= start) end += 86400000; // runs past midnight
        return {
          label: ev.descr || ev.calSummary || 'Open',
          start,
          end,
          menu: normalizeMenu(ev.menu),
        };
      })
      .filter((ev) => ev.start && ev.end)
      .sort((a, b) => a.start - b.start),
  }));
  const payMethods = (e.payMethods || []).map((p) => p.descrshort || p.descr).filter(Boolean);
  return {
    id: e.id,
    name: e.name || e.nameshort,
    nameshort: e.nameshort,
    slug: e.slug,
    area: e.campusArea?.descrshort || e.campusArea?.descr || null,
    types: (e.eateryTypes || []).map((t) => t.descrshort || t.descr).filter(Boolean),
    location: e.location || null,
    phone: e.contactPhone || null,
    about: e.aboutshort || e.about || null,
    coordinates: e.coordinates?.latitude
      ? { latitude: e.coordinates.latitude, longitude: e.coordinates.longitude }
      : e.latitude
        ? { latitude: e.latitude, longitude: e.longitude }
        : null,
    payMethods,
    acceptsSwipes: payMethods.some((p) => /swipe/i.test(p)),
    onlineOrderUrl: e.onlineOrderUrl || null,
    days,
    events: days.flatMap((d) => d.events.map((ev) => ({ ...ev, date: d.date }))),
    diningItems: (e.diningItems || [])
      .filter((i) => i?.item)
      .map((i) => ({ item: i.item, category: i.category || null, healthy: !!i.healthy })),
  };
}

async function loadEateries() {
  const { data, fetchedAt, stale } = await cachedFetch(DINING_URL, { ttlMs: DINING_TTL_MS });
  const list = data?.data?.eateries;
  if (!Array.isArray(list)) throw new Error('Unexpected Cornell Dining feed format (missing data.eateries).');
  return { eateries: list.map(normalizeEatery), fetchedAt, stale };
}

function sourceNote(fetchedAt, stale) {
  return {
    source: 'Cornell Dining Now (now.dining.cornell.edu)',
    fetched_at: fmtDayTime(fetchedAt),
    ...(stale ? { warning: 'Live feed unreachable; showing the last data fetched.' } : {}),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const span = (ev) => `${fmtTime(ev.start)}–${fmtTime(ev.end)}`;

function currentEvent(e, t) {
  return e.events.find((ev) => ev.start <= t && t < ev.end) || null;
}

function nextEvent(e, t) {
  return e.events.find((ev) => ev.start > t) || null;
}

function eventsOnDate(e, iso) {
  return e.days.find((d) => d.date === iso)?.events || [];
}

function typeLabel(e) {
  return e.types.join(', ') || null;
}

function filterEateries(eateries, { area, type, accepts_swipes } = {}) {
  let out = eateries;
  if (area) {
    const a = normalize(area).replace(/ campus$/, '');
    out = out.filter((e) => normalize(e.area).includes(a));
  }
  if (type) {
    const raw = normalize(type);
    const want = TYPE_SYNONYMS[raw] || raw;
    out = out.filter((e) => e.types.some((t) => normalize(t).includes(want)));
  }
  if (accepts_swipes) out = out.filter((e) => e.acceptsSwipes);
  return out;
}

function findEatery(eateries, name) {
  const q = normalize(name);
  const alias = ALIASES[q];
  const scored = eateries
    .map((e) => {
      const fields = [e.name, e.nameshort, e.slug, e.location];
      let score = Math.max(...fields.map((f) => matchScore(q, f)));
      if (alias) score = Math.max(score, ...fields.map((f) => (normalize(f).includes(alias) ? 90 : 0)));
      return { e, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return { match: null, candidates: [] };
  const top = scored[0];
  const ties = scored.filter((x) => x.score === top.score);
  if (ties.length > 1 && top.score < 80) return { match: null, candidates: ties.map((x) => x.e.name) };
  return { match: top.e, candidates: scored.slice(1, 4).map((x) => x.e.name) };
}

function hoursSummary(events) {
  if (!events.length) return 'Closed';
  return events.map((ev) => `${ev.label} ${span(ev)}`).join('; ');
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export async function diningOpenNow(args = {}) {
  const t = resolveInstant(args);
  const within = Number.isFinite(args.opening_within_minutes) ? args.opening_within_minutes : 60;
  const { eateries, fetchedAt, stale } = await loadEateries();
  const pool = filterEateries(eateries, args);

  const open = [];
  const openingSoon = [];
  let closed = 0;
  for (const e of pool) {
    const cur = currentEvent(e, t);
    if (cur) {
      // Merge back-to-back events (e.g. Lunch → Dinner with no gap) for the real closing time.
      let closes = cur.end;
      for (const ev of e.events) if (ev.start <= closes && ev.end > closes) closes = ev.end;
      const after = nextEvent(e, closes - 1);
      open.push({
        name: e.name,
        area: e.area,
        type: typeLabel(e),
        serving: cur.label,
        closes: fmtTime(closes),
        closes_in_minutes: minutesBetween(t, closes),
        accepts_swipes: e.acceptsSwipes,
        has_menu: cur.menu.length > 0 || e.diningItems.length > 0,
        ...(after && after.start > closes ? { reopens: `${after.label} ${fmtDayTime(after.start)}` } : {}),
      });
      continue;
    }
    const nxt = nextEvent(e, t);
    if (nxt && minutesBetween(t, nxt.start) <= within) {
      openingSoon.push({
        name: e.name,
        area: e.area,
        type: typeLabel(e),
        opens: fmtTime(nxt.start),
        opens_in_minutes: minutesBetween(t, nxt.start),
        for: nxt.label,
        accepts_swipes: e.acceptsSwipes,
      });
    } else {
      closed++;
    }
  }
  open.sort((a, b) => (a.area || '').localeCompare(b.area || '') || a.name.localeCompare(b.name));
  openingSoon.sort((a, b) => a.opens_in_minutes - b.opens_in_minutes);

  return {
    as_of: fmtDayTime(t),
    filters: pick(args, ['area', 'type', 'accepts_swipes']),
    open_count: open.length,
    open,
    opening_soon: openingSoon,
    closed_count: closed,
    ...coverageNote(eateries, easternDate(t)),
    ...sourceNote(fetchedAt, stale),
  };
}

/** Flag dates the feed hasn't published yet, so "nothing open" isn't misread as "all closed". */
function coverageNote(eateries, iso) {
  const dates = [...new Set(eateries.flatMap((e) => e.days.map((d) => d.date)))].sort();
  if (!dates.length || dates.includes(iso)) return {};
  return {
    note: `Cornell Dining hasn't published hours for ${iso}; the feed currently covers ${dates[0]} to ${dates.at(-1)}.`,
  };
}

export async function diningEatery(args = {}) {
  if (!args.name) throw new InputError('Provide an eatery name, e.g. "Okenshields" or "Morrison".');
  const { eateries, fetchedAt, stale } = await loadEateries();
  const { match, candidates } = findEatery(eateries, args.name);
  if (!match) {
    return {
      error: `No eatery clearly matches "${args.name}".`,
      did_you_mean: candidates.length ? candidates : eateries.map((e) => e.name).sort(),
    };
  }
  const day = resolveDate(args.date);
  const now = Date.now();
  let events = eventsOnDate(match, day.iso);
  if (args.meal) {
    const m = normalize(args.meal);
    const filtered = events.filter((ev) => normalize(ev.label).includes(m));
    if (filtered.length) events = filtered;
  }
  const includeMenu = args.include_menu !== false;
  const cur = currentEvent(match, now);

  return {
    name: match.name,
    area: match.area,
    type: typeLabel(match),
    location: match.location,
    phone: match.phone,
    about: match.about,
    accepts_swipes: match.acceptsSwipes,
    payment_methods: match.payMethods,
    online_order_url: match.onlineOrderUrl,
    coordinates: match.coordinates,
    open_now: cur ? { serving: cur.label, until: fmtTime(cur.end) } : false,
    date: day.iso,
    events: events.map((ev) => ({
      meal: ev.label,
      hours: span(ev),
      ...(includeMenu ? { menu: ev.menu } : {}),
    })),
    ...(events.length === 0 ? { note: `No hours listed for ${day.iso} — likely closed.` } : {}),
    ...(includeMenu && match.diningItems.length && !events.some((ev) => ev.menu.length)
      ? { regular_items: groupItems(match.diningItems) }
      : {}),
    week: match.days.map((d) => ({ date: d.date, hours: hoursSummary(d.events) })),
    ...(candidates.length ? { other_matches: candidates } : {}),
    ...sourceNote(fetchedAt, stale),
  };
}

function groupItems(items) {
  const groups = {};
  for (const i of items) (groups[i.category || 'Menu'] ||= []).push(i.item);
  return groups;
}

export async function diningMenuSearch(args = {}) {
  if (!args.query) throw new InputError('Provide a dish or ingredient to search for, e.g. "pizza".');
  const day = resolveDate(args.date);
  const qTokens = normalize(args.query).split(' ').filter(Boolean);
  const hit = (text) => {
    const n = ` ${normalize(text)} `;
    // Word-prefix match, so "taco" finds "Tacos" but "rice" doesn't find "Price".
    return qTokens.every((w) => n.includes(` ${w}`));
  };
  const { eateries, fetchedAt, stale } = await loadEateries();
  const pool = filterEateries(eateries, args);
  const now = Date.now();
  const limit = Math.min(Math.max(args.limit || 25, 1), 100);
  const meal = args.meal ? normalize(args.meal) : null;

  const results = [];
  for (const e of pool) {
    for (const ev of eventsOnDate(e, day.iso)) {
      if (meal && !normalize(ev.label).includes(meal)) continue;
      const items = [];
      for (const c of ev.menu) {
        for (const i of c.items) if (hit(i.item) || hit(c.category)) items.push(`${i.item} (${c.category})`);
      }
      if (items.length) {
        results.push({
          eatery: e.name,
          area: e.area,
          meal: ev.label,
          hours: span(ev),
          status: ev.end <= now ? 'over' : ev.start <= now ? 'serving now' : 'upcoming',
          accepts_swipes: e.acceptsSwipes,
          matches: items.slice(0, 12),
          _sort: ev.end <= now ? 2 : ev.start <= now ? 0 : 1,
          _start: ev.start,
        });
      }
    }
    // Cafés list a standing menu instead of per-meal menus.
    const regular = e.diningItems.filter((i) => hit(i.item) || hit(i.category));
    const todays = eventsOnDate(e, day.iso);
    if (regular.length && todays.length && !(meal && !todays.some((ev) => normalize(ev.label).includes(meal)))) {
      const cur = todays.find((ev) => ev.start <= now && now < ev.end);
      results.push({
        eatery: e.name,
        area: e.area,
        meal: 'Regular menu',
        hours: hoursSummary(todays),
        status: cur ? 'serving now' : todays.some((ev) => ev.start > now) ? 'upcoming' : 'over',
        accepts_swipes: e.acceptsSwipes,
        matches: regular.slice(0, 12).map((i) => i.item),
        _sort: cur ? 0 : 1,
        _start: todays[0].start,
      });
    }
  }
  results.sort((a, b) => a._sort - b._sort || a._start - b._start);
  const trimmed = results.slice(0, limit).map(({ _sort, _start, ...r }) => r);
  return {
    query: args.query,
    date: day.iso,
    result_count: results.length,
    results: trimmed,
    ...(results.length === 0
      ? { note: 'No menu items matched. Menus are usually only published a few days ahead; try a broader term.' }
      : {}),
    ...coverageNote(eateries, day.iso),
    ...sourceNote(fetchedAt, stale),
  };
}

export async function diningListEateries(args = {}) {
  const day = resolveDate(args.date);
  const { eateries, fetchedAt, stale } = await loadEateries();
  const now = Date.now();
  const list = filterEateries(eateries, args)
    .map((e) => ({
      name: e.name,
      area: e.area,
      type: typeLabel(e),
      location: e.location,
      accepts_swipes: e.acceptsSwipes,
      hours: hoursSummary(eventsOnDate(e, day.iso)),
      ...(day.iso === easternDate(now) ? { open_now: !!currentEvent(e, now) } : {}),
    }))
    .sort((a, b) => (a.area || '').localeCompare(b.area || '') || a.name.localeCompare(b.name));
  return {
    date: day.iso,
    count: list.length,
    eateries: list,
    ...coverageNote(eateries, day.iso),
    ...sourceNote(fetchedAt, stale),
  };
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined && obj[k] !== '') out[k] = obj[k];
  return Object.keys(out).length ? out : undefined;
}

// Exposed for tests.
export const _internal = { normalizeEatery, findEatery, filterEateries };
