// Cornell academic calendar: key dates (instruction begins, breaks, add/drop deadlines, exams,
// enrollment windows) read from the Registrar's academic calendar page. No JSON feed exists, so
// the page's rows are parsed; the tool says so if the layout changes.

import { InputError, cachedFetch, easternDate, fmtDayTime, htmlToText, intArg, normalize, resolveDate } from './util.mjs';

const PAGE = 'https://registrar.cornell.edu/academic-calendar';
const TTL_MS = 6 * 60 * 60 * 1000;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad = (n) => String(n).padStart(2, '0');

/** "Nov 10 – Nov 12" under the heading "November 2026" -> {start: '2026-11-10', end: '2026-11-12'}. */
function parseDates(text, headMonth, headYear) {
  const found = [...String(text).matchAll(/([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})/g)]
    .map((m) => ({ month: MONTHS.indexOf(m[1].toLowerCase()), day: +m[2] }))
    .filter((d) => d.month >= 0);
  if (!found.length) return null;
  const year = (month) => {
    // A row sits under the month it starts in; one that names another month belongs to the nearest year.
    if (month === headMonth) return headYear;
    const diff = month - headMonth;
    return diff > 6 ? headYear - 1 : diff < -6 ? headYear + 1 : headYear;
  };
  const iso = (d) => `${year(d.month)}-${pad(d.month + 1)}-${pad(d.day)}`;
  const start = iso(found[0]);
  let end = iso(found[found.length - 1]);
  if (end < start) end = `${+end.slice(0, 4) + 1}${end.slice(4)}`;
  return { start, end };
}

function parseCalendar(html) {
  const events = [];
  const body = String(html).replace(/<!--[\s\S]*?-->/g, '');
  // Split on month headings; each chunk holds that month's rows.
  const parts = body.split(/<h3[^>]*>\s*([A-Za-z]+)\s+(\d{4})\s*<\/h3>/);
  for (let i = 1; i + 2 < parts.length + 1; i += 3) {
    const month = MONTHS.indexOf(parts[i].slice(0, 3).toLowerCase());
    const year = +parts[i + 1];
    if (month < 0) continue;
    for (const row of (parts[i + 2] || '').split(/<div class="calendar-row-item[^"]*">/).slice(1)) {
      const pick = (cls) => {
        const m = new RegExp(`<span class="${cls}">([\\s\\S]*?)</span>`).exec(row);
        return m ? htmlToText(m[1]) : '';
      };
      const dateText = pick('calendar-date');
      const title = pick('calendar-date-title');
      if (!dateText || !title) continue;
      const dates = parseDates(dateText, month, year);
      if (!dates) continue;
      const time = pick('calendar-time');
      events.push({ ...dates, date_text: dateText, ...(time && time !== dateText ? { time: time } : {}), title });
    }
  }
  return events;
}

export async function academicCalendar(args = {}, nowMs = Date.now()) {
  const { data: html, fetchedAt, stale } = await cachedFetch(PAGE, { ttlMs: TTL_MS, as: 'text', edge: true });
  const all = parseCalendar(html);
  if (!all.length) throw new Error('Could not read the academic calendar page (its layout may have changed)');
  const hasQuery = !!String(args.query ?? '').trim();
  // With a query the whole published year is searched; without one, from today.
  const from = args.from ? resolveDate(args.from, nowMs).iso : hasQuery ? all[0].start : easternDate(nowMs);
  const to = args.to ? resolveDate(args.to, nowMs).iso : null;
  if (to && to < from) throw new InputError(`to (${to}) is before from (${from}).`);
  let rows = all.filter((e) => e.end >= from && (!to || e.start <= to));
  if (hasQuery) {
    const words = normalize(args.query).split(' ').filter((w) => w.length > 1 || /\d/.test(w));
    const stem = (w) => w.replace(/(ing|s)$/, '');
    rows = rows.filter((e) => {
      const t = normalize(e.title);
      return words.every((w) => t.includes(w) || t.includes(stem(w)));
    });
  }
  const limit = intArg(args.limit, hasQuery ? 25 : 15, 1, 80);
  const today = easternDate(nowMs);
  return {
    today,
    from,
    ...(to ? { to } : {}),
    ...(hasQuery ? { query: String(args.query).trim() } : {}),
    total: rows.length,
    events: rows.slice(0, limit).map((e) => ({
      date: e.start === e.end ? e.start : `${e.start} to ${e.end}`,
      ...(e.time ? { time: e.time } : {}),
      title: e.title,
      ...(e.end < today ? { past: true } : e.start <= today ? { happening_now: true } : {}),
    })),
    ...(rows.length > limit ? { not_shown: rows.length - limit } : {}),
    ...(rows.length ? {} : { note: `Nothing matches. The published calendar runs ${all[0].start} to ${all[all.length - 1].end}; try other words (e.g. "break", "exams", "drop", "enrollment", "instruction begins").` }),
    covers: `${all[0].start} to ${all[all.length - 1].end}`,
    source: PAGE,
    fetched_at: fmtDayTime(fetchedAt),
    ...(stale ? { warning: 'The Registrar page is unreachable; showing the last copy fetched.' } : {}),
  };
}

export const _internal = { parseCalendar, parseDates };
