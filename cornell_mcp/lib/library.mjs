// Cornell University Library hours: the LibCal feed behind the hours on library.cornell.edu
// (institution 973). Read-only and anonymous: nothing here touches patron accounts.
//
// Catalog search is deliberately absent: catalog.library.cornell.edu disallows all robots and
// answers requests from Cloudflare's network with a challenge page instead of JSON.

import {
  InputError,
  cachedFetch,
  easternDate,
  easternParts,
  easternToEpoch,
  fmtDayTime,
  fmtTime,
  matchScore,
  normalize,
  parseTimeOfDay,
  resolveDate,
} from './util.mjs';

const LIBCAL_GRID = 'https://api3.libcal.com/api_hours_grid.php?iid=973&format=json&systemTime=0';
const HOURS_TTL_MS = 15 * 60 * 1000;
const HOURS_PAGE = 'https://www.library.cornell.edu/libraries/';

// ---------------------------------------------------------------------------
// Hours
// ---------------------------------------------------------------------------

const NICKNAMES = [
  [/^(olin|uris|olin ?uris)$/, null],
  [/^(mann)$/, 'Mann Library'],
  [/^(psl|clark|phys(ical)? ?sci(ences)?)$/, 'Physical Sciences Library'],
  [/^(engineering|carpenter)$/, 'Engineering Library card access'],
  [/^(ilr|catherwood)$/, 'Catherwood Library'],
  [/^(hotel|nestle|statler)$/, 'Nestlé Library'],
  [/^(johnson|management|business)$/, 'Management Library'],
  [/^(vet|veterinary)$/, 'Veterinary Library Public Access'],
  [/^(rmc|rare|rare books?|kroch rare)$/, 'Kroch Library, Division of Rare & Manuscript Collections, Research Services'],
  [/^(asia|kroch asia|kroch)$/, 'Kroch Library, Division of Asia Collections'],
  [/^(math|mathematics)$/, 'Mathematics Library'],
  [/^(music|lincoln)$/, 'Music Library'],
  [/^(law|myron taylor)$/, 'Law Library'],
  [/^(fine arts|aap|rand|mui ho)$/, 'Fine Arts Library'],
  [/^(africana)$/, 'Africana Library'],
  [/^(annex)$/, 'Library Annex Contactless Pickup'],
  [/^(cocktail lounge)$/, 'Cocktail Lounge (Cornell ID required)'],
];

/** Flatten the grid into {lid, name, category, parent, days: {iso: {status, hours, text}}}. */
function parseGrid(json) {
  const out = [];
  for (const loc of json?.locations || []) {
    const days = {};
    for (const week of loc.weeks || []) {
      for (const d of Object.values(week)) {
        if (!d?.date) continue;
        const t = d.times || {};
        days[d.date] = {
          status: t.status || 'not-set',
          hours: Array.isArray(t.hours) ? t.hours : [],
          text: d.rendered || t.text || t.note || '',
        };
      }
    }
    out.push({ lid: loc.lid, name: String(loc.name || '').trim(), category: loc.category, parent: loc.parent_lid ?? null, days });
  }
  return out;
}

/** One day's posted hours as epoch intervals; a closing time at or before opening means past midnight. */
function intervals(day, y, m, d) {
  const out = [];
  for (const h of day.hours) {
    const a = parseTimeOfDay(h.from);
    const b = parseTimeOfDay(h.to);
    if (!a || !b) continue;
    const start = easternToEpoch(y, m, d, a.h, a.m);
    let end = easternToEpoch(y, m, d, b.h, b.m);
    if (end <= start) end += 24 * 3600 * 1000;
    out.push([start, end]);
  }
  return out;
}

function dayView(day, iso, nowMs) {
  if (!day || day.status === 'not-set') return { hours: 'not posted', open_now: null };
  const [y, m, d] = iso.split('-').map(Number);
  const isToday = iso === easternDate(nowMs);
  const view = { hours: day.text || day.status };
  if (!isToday) return view;
  if (day.status === '24hours') return { ...view, open_now: true };
  if (day.status === 'closed') return { ...view, open_now: false };
  if (day.status === 'open') {
    const iv = intervals(day, y, m, d);
    if (!iv.length) return { ...view, open_now: null };
    const cur = iv.find(([s, e]) => s <= nowMs && nowMs < e);
    const next = iv.find(([s]) => s > nowMs);
    return {
      ...view,
      open_now: !!cur,
      ...(cur ? { closes: fmtTime(cur[1]) } : {}),
      ...(!cur && next ? { opens: fmtTime(next[0]) } : {}),
    };
  }
  // Free-text hours ("Study space open 24/7", "11am - 5pm Law Community only"): do not guess.
  return { ...view, open_now: null };
}

async function loadGrid(weeks) {
  const { data, fetchedAt, stale } = await cachedFetch(`${LIBCAL_GRID}&weeks=${weeks}`, { ttlMs: HOURS_TTL_MS, edge: true });
  return { locations: parseGrid(data), fetchedAt, stale };
}

function hasHours(loc) {
  return Object.values(loc.days).some((d) => d.status !== 'not-set');
}

function matchLibraries(libs, text) {
  const q = normalize(text);
  if (/^(olin|uris|olin ?uris)$/.test(q)) {
    const want = q === 'olin' ? ['Olin Library'] : q === 'uris' ? ['Uris Library'] : ['Olin Library', 'Uris Library'];
    return libs.filter((l) => want.includes(l.name));
  }
  const nick = NICKNAMES.find(([re, name]) => name && re.test(q));
  if (nick) {
    const hit = libs.filter((l) => l.name === nick[1]);
    if (hit.length) return hit;
  }
  const scored = libs.map((l) => ({ l, s: matchScore(text, l.name) })).filter((x) => x.s >= 40);
  if (!scored.length) return [];
  const best = Math.max(...scored.map((x) => x.s));
  return scored.filter((x) => x.s === best).map((x) => x.l);
}

export async function libraryHours(args = {}, nowMs = Date.now()) {
  const day = resolveDate(args.date, nowMs);
  const today = easternDate(nowMs);
  if (day.iso < today) throw new InputError('Library hours are only available for today and future dates.');
  const p = easternParts(nowMs);
  const sunday = easternToEpoch(p.year, p.month, p.day, 12) - p.weekdayIndex * 86400000;
  const target = easternToEpoch(day.y, day.m, day.d, 12);
  const weeksAhead = Math.floor((target - sunday) / (7 * 86400000));
  if (weeksAhead > 25) throw new InputError('Library hours are posted about six months ahead at most; pick a nearer date.');
  // A named library also gets the following six days, which can run into the next week.
  const { locations, fetchedAt, stale } = await loadGrid(Math.max(2, weeksAhead + 2));

  const all = locations.filter(hasHours);
  const libs = all.filter((l) => l.category === 'library');
  const servicesOf = (lib) => all.filter((l) => l.parent === lib.lid && l.name.length > 1);
  let chosen = libs;
  if (args.library) {
    chosen = matchLibraries(libs, args.library);
    if (!chosen.length) {
      // A service desk or space (e.g. "Libe Cafe", "Map Room") can be asked for by name too.
      chosen = matchLibraries(all.filter((l) => l.category !== 'library' && l.name.length > 1), args.library);
    }
    if (!chosen.length) {
      return { error: `No library matches "${args.library}".`, libraries: libs.map((l) => l.name) };
    }
  }

  const single = !!args.library;
  const withServices = single || args.include_services === true;
  const view = (loc) => dayView(loc.days[day.iso], day.iso, nowMs);
  const rows = chosen.map((lib) => {
    const parent = lib.parent ? all.find((l) => l.lid === lib.parent) : null;
    const row = { name: lib.name, ...(parent ? { part_of: parent.name } : {}), ...view(lib) };
    if (withServices) {
      const sv = servicesOf(lib).map((s) => ({ name: s.name, ...view(s) }));
      if (sv.length) row.services = sv;
    }
    if (single) {
      row.next_days = {};
      for (let i = 1; i <= 6; i++) {
        const iso = easternDate(target + i * 86400000);
        const d = lib.days[iso];
        if (d) row.next_days[iso] = d.status === 'not-set' ? 'not posted' : d.text || d.status;
      }
    }
    return row;
  });
  if (!single && day.iso === today) rows.sort((a, b) => (b.open_now === true) - (a.open_now === true));

  return {
    date: day.iso,
    ...(day.iso === today ? { as_of: fmtDayTime(nowMs) } : {}),
    ...(args.open_only && day.iso === today
      ? { libraries: rows.filter((r) => r.open_now === true || r.services?.some((s) => s.open_now === true)) }
      : { libraries: rows }),
    note: 'open_now is null where the library posts free-text hours (read the hours text). Some spaces are card access only.',
    source: HOURS_PAGE,
    fetched_at: fmtDayTime(fetchedAt),
    ...(stale ? { warning: 'The hours feed is unreachable; showing the last copy fetched.' } : {}),
  };
}

export const _internal = { parseGrid, dayView, intervals, matchLibraries };
