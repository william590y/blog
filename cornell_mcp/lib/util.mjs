// Shared helpers: HTTP fetches, Eastern-time math, text normalization.
// No third-party dependencies. Runs on Cloudflare Workers (global fetch + Intl); this copy
// drops the skill's curl/proxy path, which needs node:child_process.

export const TZ = 'America/New_York';

/** A problem with what the caller asked for (not with the data source). */
export class InputError extends Error {}

const USER_AGENT = 'cornell-campus-mcp/0.1 (+https://williamliaw.com/mcp)';

// ---------------------------------------------------------------------------
// Fetching with a small in-memory cache (and stale fallback if a source is down)
// ---------------------------------------------------------------------------

const cache = new Map();

export async function cachedFetch(url, { ttlMs, as = 'json', timeoutMs = 20000 }) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < ttlMs) {
    return { data: hit.data, fetchedAt: hit.at, stale: false };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const host = new URL(url).host;
  try {
    const res = await fetch(url, {
      headers: {
        'user-agent': USER_AGENT,
        accept: as === 'json' ? 'application/json' : 'text/html,application/xhtml+xml',
      },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`${host} returned HTTP ${res.status}`);
    const data = as === 'json' ? await res.json() : await res.text();
    cache.set(url, { at: Date.now(), data });
    return { data, fetchedAt: Date.now(), stale: false };
  } catch (err) {
    if (hit) return { data: hit.data, fetchedAt: hit.at, stale: true };
    if (err.name === 'AbortError') throw new Error(`Timed out reaching ${host}`);
    if (err.cause?.code) throw new Error(`Could not reach ${host} (${err.cause.code})`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Time: everything user-facing is Cornell local time (America/New_York)
// ---------------------------------------------------------------------------

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
export { WEEKDAYS };

const partsFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
  weekday: 'long',
});

export function easternParts(ms = Date.now()) {
  const o = {};
  for (const p of partsFmt.formatToParts(new Date(ms))) o[p.type] = p.value;
  return {
    year: +o.year,
    month: +o.month,
    day: +o.day,
    hour: +o.hour % 24,
    minute: +o.minute,
    second: +o.second,
    weekday: o.weekday.toLowerCase(),
    weekdayIndex: WEEKDAYS.indexOf(o.weekday.toLowerCase()),
  };
}

const pad = (n) => String(n).padStart(2, '0');

/** YYYY-MM-DD for the Eastern calendar day containing `ms`. */
export function easternDate(ms = Date.now()) {
  const p = easternParts(ms);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Wall-clock Eastern time → epoch ms (DST-aware). */
export function easternToEpoch(y, m, d, h = 0, mi = 0, s = 0) {
  const target = Date.UTC(y, m - 1, d, h, mi, s);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const p = easternParts(guess);
    const seen = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    if (seen === target) break;
    guess += target - seen;
  }
  return guess;
}

const timeFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric' });

/** "5:30pm" */
export function fmtTime(ms) {
  return timeFmt
    .format(new Date(ms))
    .replace(/[\s ]*(AM|PM)$/i, (_, ap) => ap.toLowerCase());
}

/** "Wed, Oct 28, 5:30pm" */
export function fmtDayTime(ms) {
  return `${dayFmt.format(new Date(ms))}, ${fmtTime(ms)}`;
}

/** Parse "9pm", "9:30 PM", "21:00", "noon", "midnight" → {h, m} or null. */
export function parseTimeOfDay(text) {
  if (!text) return null;
  const t = String(text).trim().toLowerCase();
  if (t === 'noon') return { h: 12, m: 0 };
  if (t === 'midnight') return { h: 0, m: 0 };
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?$/.exec(t.replace(/\./g, ''));
  if (!m) return null;
  let h = +m[1];
  const mi = m[2] ? +m[2] : 0;
  const ap = m[3]?.[0];
  if (ap === 'p' && h < 12) h += 12;
  if (ap === 'a' && h === 12) h = 0;
  if (h > 23 || mi > 59) return null;
  return { h, m: mi };
}

/**
 * Resolve a user-supplied date ("today", "tomorrow", "friday", "2026-10-30")
 * to {y, m, d, iso}. Weekday names mean the next occurrence, counting today.
 */
export function resolveDate(text, nowMs = Date.now()) {
  const today = easternParts(nowMs);
  const t = (text || 'today').trim().toLowerCase();
  const fromOffset = (days) => {
    // Use noon to stay clear of DST edges when stepping days.
    const ms = easternToEpoch(today.year, today.month, today.day, 12) + days * 86400000;
    const p = easternParts(ms);
    return { y: p.year, m: p.month, d: p.day, iso: `${p.year}-${pad(p.month)}-${pad(p.day)}` };
  };
  if (t === 'today' || t === 'now' || t === 'tonight') return fromOffset(0);
  if (t === 'tomorrow') return fromOffset(1);
  if (t === 'yesterday') return fromOffset(-1);
  const wd = WEEKDAYS.findIndex((w) => w === t || w.slice(0, 3) === t.slice(0, 3));
  if (wd >= 0 && /^[a-z]+$/.test(t)) return fromOffset((wd - today.weekdayIndex + 7) % 7);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (iso) return { y: +iso[1], m: +iso[2], d: +iso[3], iso: t };
  throw new InputError(`Could not understand date "${text}". Use today, tomorrow, a weekday name, or YYYY-MM-DD.`);
}

/**
 * Resolve optional {date, time} into an epoch ms instant.
 * - neither → now
 * - time may be a full ISO timestamp, or a time of day on `date` (default today)
 */
export function resolveInstant({ date, time } = {}, nowMs = Date.now()) {
  if (time && /\d{4}-\d{2}-\d{2}t/i.test(time)) {
    const ms = Date.parse(time);
    if (Number.isNaN(ms)) throw new InputError(`Could not parse time "${time}".`);
    return ms;
  }
  if (!date && !time) return nowMs;
  const day = resolveDate(date, nowMs);
  if (!time) {
    // A date with no time: use now's time-of-day if it's today, else noon.
    if (day.iso === easternDate(nowMs)) return nowMs;
    return easternToEpoch(day.y, day.m, day.d, 12);
  }
  const tod = parseTimeOfDay(time);
  if (!tod) throw new InputError(`Could not understand time "${time}". Try "7pm" or "19:00".`);
  return easternToEpoch(day.y, day.m, day.d, tod.h, tod.m);
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

export function normalize(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Score how well `query` matches `candidate` (0 = no match). */
export function matchScore(query, candidate) {
  const q = normalize(query);
  const c = normalize(candidate);
  if (!q || !c) return 0;
  if (q === c) return 100;
  if (c.startsWith(q)) return 80;
  if (c.includes(q)) return 60;
  const qt = q.split(' ');
  const ct = new Set(c.split(' '));
  const hits = qt.filter((w) => ct.has(w) || [...ct].some((x) => x.startsWith(w) && w.length >= 3));
  if (hits.length === qt.length) return 40;
  if (hits.length) return 10 * hits.length;
  return 0;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘' };

export function htmlToText(html) {
  return String(html)
    .replace(/<br\s*\/?>/gi, ' / ')
    .replace(/<\/(p|div|li)>/gi, ' / ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') {
        const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, ' ')
    .replace(/(\s*\/\s*)+/g, ' / ')
    .replace(/^\s*\/\s*|\s*\/\s*$/g, '')
    .trim();
}

export function minutesBetween(fromMs, toMs) {
  return Math.round((toMs - fromMs) / 60000);
}
