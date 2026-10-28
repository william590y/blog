// Cornell Fitness Centers: live headcounts + posted hours and today's group fitness classes.
//
// Headcounts come from the Connect2Concepts / GoBoard feed that powers the
// "How Busy is CFC?" widget on scl.cornell.edu (the same source Cornell AppDev's
// Uplift app uses). Hours and classes are read from the Fitness Centers web page.

import {
  WEEKDAYS,
  cachedFetch,
  easternParts,
  easternToEpoch,
  fmtDayTime,
  fmtTime,
  htmlToText,
  matchScore,
  minutesBetween,
  normalize,
} from './util.mjs';

const GYM_COUNTS_URL =
  'https://goboardapi.azurewebsites.net/api/FacilityCount/GetCountsByAccount?AccountAPIKey=355de24d-d0e4-4262-ae97-bc0c78b92839';
const FITNESS_PAGE_URL = 'https://scl.cornell.edu/recreation/cornell-fitness-centers';

const COUNTS_TTL_MS = 60 * 1000;
const PAGE_TTL_MS = 30 * 60 * 1000;

// Canonical keys so headcount names ("Teagle Down Fitness Center") line up with
// page names ("Teagle Downstairs"). Order matters: check "teagle down" before "teagle".
const GYM_KEYS = [
  ['helen newman', 'Helen Newman', 'North Campus (Helen Newman Hall)'],
  ['hnh', 'Helen Newman', 'North Campus (Helen Newman Hall)'],
  ['toni morrison', 'Toni Morrison', 'North Campus (Toni Morrison Hall)'],
  ['morrison', 'Toni Morrison', 'North Campus (Toni Morrison Hall)'],
  ['noyes', 'Noyes', 'West Campus (Noyes Community Recreation Center)'],
  ['teagle down', 'Teagle Downstairs', 'Central Campus (Teagle Hall)'],
  ['teagle up', 'Teagle Upstairs', 'Central Campus (Teagle Hall)'],
];

function gymKey(name) {
  const n = normalize(name);
  const hit = GYM_KEYS.find(([k]) => n.includes(k));
  return hit ? { key: hit[1], where: hit[2] } : null;
}

// ---------------------------------------------------------------------------
// Posted hours + classes (HTML tables on the Fitness Centers page)
// ---------------------------------------------------------------------------

function parseTables(html) {
  const tables = [];
  for (const tm of html.matchAll(/<table\b[\s\S]*?<\/table>/gi)) {
    const rows = [];
    for (const rm of tm[0].matchAll(/<tr\b[\s\S]*?<\/tr>/gi)) {
      const cells = [];
      for (const cm of rm[0].matchAll(/<(td|th)\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
        const colspan = Number(/colspan\s*=\s*["']?(\d+)/i.exec(cm[2])?.[1] || 1);
        const text = htmlToText(cm[3]);
        // A merged cell (e.g. "Monday – Thursday" spanning Friday) applies to every column it covers.
        for (let i = 0; i < colspan; i++) cells.push({ text, merged: i > 0 });
      }
      if (cells.length) rows.push(cells);
    }
    if (rows.length) tables.push(rows);
  }
  return tables;
}

const DAY_ABBR = WEEKDAYS.map((d) => d.slice(0, 3));

/** Which weekdays (0=Sun) does a column header like "Monday - Thursday" or "Weekend" cover? */
function daysForHeader(label) {
  const l = normalize(label);
  if (/weekend/.test(l)) return [0, 6];
  if (/daily|every day|all week/.test(l)) return [0, 1, 2, 3, 4, 5, 6];
  if (/weekday/.test(l)) return [1, 2, 3, 4, 5];
  const found = [...l.matchAll(/\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*/g)].map((m) => DAY_ABBR.indexOf(m[1]));
  if (found.length === 2 && /-|–|through|thru|to/.test(String(label))) {
    const out = [];
    for (let d = found[0]; ; d = (d + 1) % 7) {
      out.push(d);
      if (d === found[1] || out.length > 7) break;
    }
    return out;
  }
  return found;
}

/** "7:00am - 9:30am / 12:00pm - 10:30pm" → [{startMin, endMin}] (minutes after midnight). */
function parseRanges(text) {
  const out = [];
  const re = /(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)\s*(?:-|–|—|to)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)/gi;
  for (const m of String(text).matchAll(re)) {
    const toMin = (h, mi, ap) => ((+h % 12) + (ap[0].toLowerCase() === 'p' ? 12 : 0)) * 60 + (+mi || 0);
    let startMin = toMin(m[1], m[2], m[3]);
    let endMin = toMin(m[4], m[5], m[6]);
    if (endMin <= startMin) endMin += 24 * 60; // past midnight
    out.push({ startMin, endMin });
  }
  return out;
}

async function loadSchedule() {
  const { data: html, fetchedAt, stale } = await cachedFetch(FITNESS_PAGE_URL, { ttlMs: PAGE_TTL_MS, as: 'text' });
  const tables = parseTables(html);

  const hoursTable = tables.find((t) => t[0].some((c) => /monday|weekend|friday/i.test(c.text)));
  const classTable = tables.find((t) => t[0].some((c) => /instructor/i.test(c.text)));

  const facilities = [];
  if (hoursTable) {
    const header = hoursTable[0].map((c) => c.text);
    for (const row of hoursTable.slice(1)) {
      const name = row[0]?.text;
      if (!name || !gymKey(name)) continue;
      const columns = [];
      for (let i = 1; i < header.length; i++) {
        let text = row[i]?.text ?? '';
        let note;
        if (!text && i > 1 && row[i - 1]?.text) {
          // Blank cell next to a filled one is how the page shows "same as previous column".
          text = row[i - 1].text;
          note = 'same as previous column on the page';
        }
        columns.push({ label: header[i], days: daysForHeader(header[i]), text: text || 'Not listed', ranges: parseRanges(text), ...(note ? { note } : {}) });
      }
      facilities.push({ name, ...gymKey(name), columns });
    }
  }

  const classes = [];
  if (classTable) {
    const header = classTable[0].map((c) => normalize(c.text));
    const col = (k) => header.findIndex((h) => h.includes(k));
    const [ci, ti, ii, li] = [col('class'), col('time'), col('instructor'), col('location')];
    for (const row of classTable.slice(1)) {
      const get = (i) => (i >= 0 ? row[i]?.text || null : null);
      if (!get(ci)) continue;
      classes.push({ class: get(ci), time: get(ti), instructor: get(ii), location: get(li) });
    }
  }

  return { facilities, classes, fetchedAt, stale, parsedHours: !!hoursTable };
}

function scheduleStatus(fac, t = Date.now()) {
  const p = easternParts(t);
  const minuteOfDay = p.hour * 60 + p.minute;
  const today = fac.columns.find((c) => c.days.includes(p.weekdayIndex));
  if (!today) return { today: null, open_now: null };
  const ranges = today.ranges;
  const dayStart = easternToEpoch(p.year, p.month, p.day, 0, 0);
  const cur = ranges.find((r) => r.startMin <= minuteOfDay && minuteOfDay < r.endMin);
  const next = ranges.find((r) => r.startMin > minuteOfDay);
  return {
    today: today.text,
    open_now: ranges.length ? !!cur : /closed/i.test(today.text) ? false : null,
    ...(cur ? { closes: fmtTime(dayStart + cur.endMin * 60000) } : {}),
    ...(!cur && next ? { opens: fmtTime(dayStart + next.startMin * 60000) } : {}),
  };
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

function level(pct) {
  if (pct == null) return 'unknown';
  if (pct < 25) return 'quiet';
  if (pct < 50) return 'moderate';
  if (pct < 75) return 'busy';
  return 'very busy';
}

/** GoBoard timestamps are local (Eastern) wall-clock time without an offset. */
function parseUpdated(s) {
  if (!s) return null;
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) return Date.parse(s);
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(s);
  if (!m) return null;
  return easternToEpoch(+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] || 0));
}

export async function gymOccupancy(args = {}) {
  const now = Date.now();
  const [{ data, fetchedAt, stale }, schedule] = await Promise.all([
    cachedFetch(GYM_COUNTS_URL, { ttlMs: COUNTS_TTL_MS }),
    loadSchedule().catch(() => null), // hours are a bonus; never fail the headcount on them
  ]);
  if (!Array.isArray(data)) throw new Error('Unexpected gym headcount feed format (expected a list).');

  let rows = data.map((f) => {
    const name = f.LocationName || f.FacilityName || 'Unknown';
    const count = Number(f.LastCount ?? f.CurrentCount ?? 0);
    const cap = Number(f.TotalCapacity ?? 0);
    const pct = cap > 0 ? Math.round((count / cap) * 100) : null;
    const updated = parseUpdated(f.LastUpdatedDateAndTime);
    const isFitness = /fitness/i.test(name);
    const g = isFitness ? gymKey(name) : null;
    const fac = g && schedule?.facilities.find((x) => x.key === g.key);
    const hours = fac ? scheduleStatus(fac, now) : null;
    const closed = f.IsClosed === true || hours?.open_now === false;
    return {
      name,
      kind: isFitness ? 'fitness center' : /court|basketball|volleyball|badminton/i.test(name) ? 'court' : 'other',
      ...(g ? { campus: g.where } : {}),
      count,
      capacity: cap || null,
      percent_full: pct,
      level: closed && count === 0 ? 'closed' : level(pct),
      ...(hours ? { open_now: hours.open_now, hours_today: hours.today, ...pick(hours, ['closes', 'opens']) } : {}),
      ...(updated ? { last_updated: fmtTime(updated), minutes_since_update: minutesBetween(updated, now) } : {}),
    };
  });

  if (args.facility) {
    const scored = rows.map((r) => ({ r, s: matchScore(args.facility, r.name) || (gymKey(args.facility) && gymKey(args.facility).key === gymKey(r.name)?.key ? 70 : 0) }));
    const best = Math.max(...scored.map((x) => x.s));
    rows = best > 0 ? scored.filter((x) => x.s >= Math.min(best, 40)).map((x) => x.r) : [];
    if (!rows.length) {
      return { error: `No facility matches "${args.facility}".`, facilities: data.map((f) => f.LocationName) };
    }
  } else if (!args.include_courts) {
    rows = rows.filter((r) => r.kind === 'fitness center');
  }

  rows.sort((a, b) => (a.level === 'closed') - (b.level === 'closed') || (a.percent_full ?? 999) - (b.percent_full ?? 999));

  return {
    as_of: fmtDayTime(now),
    facilities: rows,
    source: 'Cornell Fitness Centers live headcount (Connect2Concepts "How Busy is CFC?" widget)',
    fetched_at: fmtDayTime(fetchedAt),
    ...(stale ? { warning: 'Headcount feed unreachable; showing the last counts fetched.' } : {}),
    ...(schedule ? {} : { note: 'Posted hours could not be loaded, so open/closed is from the headcount feed only.' }),
  };
}

export async function gymSchedule(args = {}) {
  const now = Date.now();
  const s = await loadSchedule();
  let facilities = s.facilities;
  if (args.facility) {
    const g = gymKey(args.facility);
    facilities = facilities.filter((f) => (g ? f.key === g.key : matchScore(args.facility, f.name) > 0));
  }
  const warnings = [];
  if (!s.parsedHours) warnings.push('Could not find the hours table on the page; its layout may have changed.');
  if (s.stale) warnings.push('Fitness page unreachable; showing the last copy fetched.');
  const p = easternParts(now);
  const classes = s.classes.map((c) => {
    const r = parseRanges(c.time || '')[0];
    const canceled = /cancel/i.test(c.time || '');
    let status = canceled ? 'canceled' : null;
    if (!canceled && r) {
      const m = p.hour * 60 + p.minute;
      status = m < r.startMin ? 'upcoming' : m < r.endMin ? 'in progress' : 'over';
    }
    return { ...c, ...(status ? { status } : {}) };
  });

  return {
    as_of: fmtDayTime(now),
    hours_note:
      'Regular semester hours as posted on the Cornell Fitness Centers page. Breaks, holidays and weather closures can differ — call the center if it matters.',
    facilities: facilities.map((f) => ({
      name: f.name,
      campus: f.where,
      hours: Object.fromEntries(f.columns.map((c) => [c.label, c.text])),
      ...scheduleStatus(f, now),
    })),
    todays_classes: args.facility ? classes.filter((c) => matchScore(args.facility, c.location || '') > 0 || !c.location) : classes,
    source: FITNESS_PAGE_URL,
    fetched_at: fmtDayTime(s.fetchedAt),
    ...(warnings.length ? { warnings } : {}),
  };
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

export const _internal = { parseTables, parseRanges, daysForHeader, gymKey, scheduleStatus, loadSchedule };
