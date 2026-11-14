// Cornell University Library: hours (the LibCal feed behind the hours on library.cornell.edu,
// institution 973) and catalog search (the Blacklight catalog's JSON view). Read-only and
// anonymous: nothing here touches patron accounts.

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
  normalize,
  parseTimeOfDay,
  resolveDate,
  truncate,
} from './util.mjs';

const LIBCAL_GRID = 'https://api3.libcal.com/api_hours_grid.php?iid=973&format=json&systemTime=0';
const CATALOG = 'https://catalog.library.cornell.edu';
const HOURS_TTL_MS = 15 * 60 * 1000;
const CATALOG_TTL_MS = 10 * 60 * 1000;
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

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

const SEARCH_FIELDS = {
  all: 'all_fields',
  title: 'title',
  author: 'author',
  subject: 'subject',
  'call number': 'lc_callnum',
  callnumber: 'lc_callnum',
  isbn: 'isbnissn',
  issn: 'isbnissn',
  publisher: 'publisher',
  series: 'series',
};

const FORMATS = ['Book', 'Journal/Periodical', 'Manuscript/Archive', 'Musical Score', 'Musical Recording', 'Video', 'Map', 'Thesis', 'Database', 'Non-musical Recording', 'Image', 'Computer File', 'Microform', 'Newspaper'];

const first = (v) => (Array.isArray(v) ? v[0] : v) ?? null;
const list = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
const parseJson = (s) => {
  try {
    return typeof s === 'string' ? JSON.parse(s) : s ?? null;
  } catch {
    return null;
  }
};

function availability(doc) {
  const a = parseJson(doc.availability_json);
  if (!a) return null;
  const places = (o) => Object.entries(o || {}).map(([where, call]) => (call ? `${where}: ${call}` : where));
  return {
    available: a.available === true,
    ...(a.availAt ? { available_at: places(a.availAt) } : {}),
    ...(a.unavailAt ? { unavailable_at: places(a.unavailAt) } : {}),
    ...(a.online ? { online: true } : {}),
  };
}

function onlineLinks(doc) {
  return list(doc.url_access_json)
    .map(parseJson)
    .filter((u) => u?.url)
    .slice(0, 3)
    .map((u) => ({ url: u.url, ...(u.description ? { note: truncate(u.description, 140) } : {}) }));
}

function catalogSummary(doc) {
  const avail = availability(doc);
  const links = onlineLinks(doc);
  return {
    id: String(doc.id),
    title: doc.fulltitle_display || doc.title_display || '(untitled)',
    ...(doc.author_display ? { author: doc.author_display } : {}),
    format: list(doc.format).join(', ') || null,
    ...(first(doc.pub_info_display) ? { published: first(doc.pub_info_display) } : {}),
    ...(first(doc.edition_display) ? { edition: first(doc.edition_display) } : {}),
    access: list(doc.online).join(', ') || null,
    ...(avail ? { availability: avail } : {}),
    ...(links.length ? { online_access: 'Cornell login may be required', links: links.slice(0, 1) } : {}),
    url: `${CATALOG}/catalog/${doc.id}`,
  };
}

function holdings(doc) {
  const h = parseJson(doc.holdings_json) || {};
  const items = parseJson(doc.items_json) || {};
  return Object.entries(h)
    .filter(([, v]) => v && v.active !== false)
    .slice(0, 15)
    .map(([hid, v]) => {
      const its = items[hid] || [];
      const statuses = {};
      for (const it of its) {
        const st = it.status?.status || 'Unknown';
        statuses[st] = (statuses[st] || 0) + 1;
      }
      const due = its.map((it) => it.status?.due).filter(Boolean).sort()[0];
      return {
        location: v.location?.name || 'Unknown location',
        ...(v.call ? { call_number: v.call } : {}),
        ...(v.copy ? { copy: v.copy } : {}),
        ...(Object.keys(statuses).length ? { items: statuses } : v.items ? { items: { count: v.items.count } } : {}),
        ...(due ? { earliest_due: easternDate(due * 1000) } : {}),
        ...(v.circ === false ? { circulates: false } : {}),
        ...(v.notes?.length ? { notes: v.notes.slice(0, 2).map((n) => truncate(n, 120)) } : {}),
      };
    });
}

function catalogDetail(doc) {
  const s = catalogSummary(doc);
  const links = onlineLinks(doc);
  return {
    ...s,
    ...(list(doc.title_responsibility_display).length ? { responsibility: first(doc.title_responsibility_display) } : {}),
    ...(first(doc.description_display) ? { physical: first(doc.description_display) } : {}),
    ...(list(doc.language_display).length ? { language: list(doc.language_display).join(' ') } : {}),
    ...(list(doc.subject_display).length ? { subjects: list(doc.subject_display).slice(0, 12) } : {}),
    ...(list(doc.summary_display).length ? { summary: truncate(list(doc.summary_display).join(' '), 900) } : {}),
    ...(list(doc.contents_display).length ? { contents: truncate(list(doc.contents_display).join(' -- '), 700) } : {}),
    ...(list(doc.notes_display).length ? { notes: list(doc.notes_display).slice(0, 4).map((n) => truncate(n, 200)) } : {}),
    ...(list(doc.isbn_display).length ? { isbn: list(doc.isbn_display).slice(0, 4) } : {}),
    ...(list(doc.oclc_id_display).length ? { oclc: first(doc.oclc_id_display) } : {}),
    ...(links.length ? { links } : {}),
    holdings: holdings(doc),
    note: 'Availability is from the catalog index and can lag by some hours; requests and renewals need a Cornell login on the catalog page.',
  };
}

export async function libraryCatalogSearch(args = {}) {
  const query = String(args.query ?? '').trim();
  if (!query) throw new InputError('query is required, e.g. a title, author or topic.');
  const fieldKey = normalize(args.field || 'all');
  const field = SEARCH_FIELDS[fieldKey];
  if (!field) throw new InputError(`field must be one of: ${Object.keys(SEARCH_FIELDS).filter((k) => k !== 'callnumber' && k !== 'issn').join(', ')}.`);
  const limit = intArg(args.limit, 10, 1, 25);
  const page = intArg(args.page, 1, 1, 200);
  const params = new URLSearchParams({ q: query, search_field: field, per_page: String(limit), page: String(page) });
  if (args.format) {
    const f = FORMATS.find((x) => normalize(x) === normalize(args.format)) || FORMATS.find((x) => matchScore(args.format, x) >= 40);
    if (!f) throw new InputError(`Unknown format "${args.format}". Formats: ${FORMATS.join(', ')}.`);
    params.append('f[format][]', f);
  }
  if (args.online_only) params.append('f[online][]', 'Online');
  if (args.library) params.append('f[location][]', String(args.library));
  const { data } = await cachedFetch(`${CATALOG}/catalog.json?${params}`, { ttlMs: CATALOG_TTL_MS, edge: true, timeoutMs: 25000 });
  const docs = data?.response?.document;
  if (!Array.isArray(docs)) throw new Error('Unexpected catalog reply (no document list).');
  return {
    query,
    field: fieldKey,
    page,
    count: docs.length,
    results: docs.map(catalogSummary),
    ...(docs.length === limit ? { more: `There may be more: ask for page ${page + 1}.` } : {}),
    ...(docs.length ? {} : { note: 'Nothing found. Try fewer words, another field, or drop the filters.' }),
    search_url: `${CATALOG}/catalog?${new URLSearchParams({ q: query, search_field: field })}`,
    source: 'Cornell University Library catalog',
  };
}

export async function libraryCatalogItem(args = {}) {
  const id = String(args.id ?? '').trim();
  if (!/^\d{1,12}$/.test(id)) throw new InputError('id must be the catalog record number from library_catalog_search, e.g. "857387".');
  let doc;
  try {
    ({ data: doc } = await cachedFetch(`${CATALOG}/catalog/${id}/raw`, { ttlMs: CATALOG_TTL_MS, edge: true, timeoutMs: 25000 }));
  } catch (err) {
    // The catalog answers an unknown record with 404 or, for some ids, 500.
    if (err instanceof HttpError && (err.status === 404 || err.status === 500)) {
      throw new InputError(`No catalog record ${id}. Use library_catalog_search to find the record id.`);
    }
    throw err;
  }
  if (!doc || typeof doc !== 'object' || !doc.id) throw new InputError(`No catalog record ${id}.`);
  return catalogDetail(doc);
}

export const _internal = { parseGrid, dayView, intervals, catalogSummary, catalogDetail, holdings, matchLibraries };
