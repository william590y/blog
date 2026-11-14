// Cornell Class Roster (classes.cornell.edu/api/2.0): terms, subjects, class search and one
// course's sections. The API is public and documented; it asks for at most one request a second,
// so everything is cached. Instructor NetIDs in the feed are dropped; only names are returned.

import { HttpError, InputError, cachedFetch, easternParts, intArg, matchScore, normalize, truncate } from './util.mjs';

const BASE = 'https://classes.cornell.edu/api/2.0';
const ROSTERS_TTL_MS = 6 * 60 * 60 * 1000;
const SUBJECTS_TTL_MS = 6 * 60 * 60 * 1000;
const SEARCH_TTL_MS = 10 * 60 * 1000;

const SEASONS = { WI: 'winter', SP: 'spring', SU: 'summer', FA: 'fall' };
const STATUS = { O: 'open', C: 'closed', W: 'waitlist' };
const LEVELS = [1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000];

async function api(path, ttlMs) {
  const { data } = await cachedFetch(`${BASE}${path}`, { ttlMs, edge: true });
  if (data?.status !== 'success') throw new Error(`Class Roster API error: ${data?.message || 'unexpected reply'}`);
  return data.data;
}

async function loadRosters() {
  const d = await api('/config/rosters.json', ROSTERS_TTL_MS);
  return (d.rosters || []).map((r) => ({ slug: r.slug, name: r.descr, default: r.isDefaultRoster === 'Y' }));
}

/** Which term is in session on this date (approximate boundaries; used only for roster "current"). */
function currentSlug(nowMs = Date.now()) {
  const p = easternParts(nowMs);
  const md = p.month * 100 + p.day;
  const season = md <= 120 ? 'WI' : md <= 531 ? 'SP' : md <= 820 ? 'SU' : 'FA';
  return `${season}${String(p.year).slice(2)}`;
}

/** "FA26", "fall 2026", "Spring 27", "current", or nothing (Cornell's default roster) -> a roster. */
async function resolveRoster(text, nowMs = Date.now()) {
  const rosters = await loadRosters();
  const t = String(text ?? '').trim();
  let slug;
  if (!t || /^default$/i.test(t)) {
    const d = rosters.find((r) => r.default) || rosters[rosters.length - 1];
    if (!d) throw new Error('The Class Roster API listed no rosters.');
    return d;
  }
  if (/^(current|now|this (term|semester))$/i.test(t)) slug = currentSlug(nowMs);
  else {
    const m = /^(wi|sp|su|fa)[a-z]*\s*'?(\d{2}|\d{4})$/i.exec(t) || /^(\d{4}|\d{2})\s*(wi|sp|su|fa)[a-z]*$/i.exec(t);
    if (m) {
      const [season, year] = /^\d/.test(m[1]) ? [m[2], m[1]] : [m[1], m[2]];
      slug = `${season.slice(0, 2).toUpperCase()}${year.slice(-2)}`;
    }
  }
  const hit = slug && rosters.find((r) => r.slug === slug);
  if (hit) return hit;
  const recent = rosters.slice(-6).map((r) => `${r.slug} (${r.name})`).join(', ');
  throw new InputError(
    `No roster matches "${t}". Use a code like FA26 or SP27, "fall 2026", "current", or omit it for Cornell's default roster. Recent rosters: ${recent}.`,
  );
}

async function loadSubjects(roster) {
  const d = await api(`/config/subjects.json?roster=${roster}`, SUBJECTS_TTL_MS);
  return (d.subjects || []).map((s) => ({ code: s.value, name: s.descrformal || s.descr }));
}

async function resolveSubject(roster, text) {
  const t = String(text ?? '').trim();
  if (!t) throw new InputError('A subject is required (the Class Roster API searches one subject at a time), e.g. "CS", "MATH" or "Music". Use classes_subjects to list them.');
  const subjects = await loadSubjects(roster.slug);
  const exact = subjects.find((s) => s.code === t.toUpperCase().replace(/\s+/g, ''));
  if (exact) return exact;
  const scored = subjects.map((s) => ({ s, score: matchScore(t, s.name) })).filter((x) => x.score >= 40).sort((a, b) => b.score - a.score);
  if (scored.length && (scored.length === 1 || scored[0].score > scored[1].score)) return scored[0].s;
  const options = (scored.length ? scored.map((x) => x.s) : subjects.filter((s) => matchScore(t, s.name) > 0)).slice(0, 8);
  throw new InputError(
    `${scored.length ? 'Several subjects match' : 'No subject matches'} "${t}" in ${roster.slug}.${options.length ? ` Did you mean: ${options.map((s) => `${s.code} (${s.name})`).join(', ')}?` : ' Use classes_subjects to list subject codes.'}`,
  );
}

async function searchClasses(roster, subject, params = '') {
  try {
    const d = await api(`/search/classes.json?roster=${roster}&subject=${encodeURIComponent(subject)}${params}`, SEARCH_TTL_MS);
    return d.classes || [];
  } catch (err) {
    // The API answers "no classes match" with HTTP 404.
    if (err instanceof HttpError && err.status === 404) return [];
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Shaping
// ---------------------------------------------------------------------------

const fmtClock = (t) => (t ? t.replace(/^0/, '').replace(/(AM|PM)$/, (m) => m.toLowerCase()) : '');
const fmtDate = (d) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(d || '');
  return m ? `${m[3]}-${m[1]}-${m[2]}` : d || null;
};
const instructorNames = (list) => (list || []).map((i) => [i.firstName, i.lastName].filter(Boolean).join(' ')).filter(Boolean);
const uniq = (a) => [...new Set(a)];

function meetingText(m) {
  const time = m.timeStart ? `${fmtClock(m.timeStart)}-${fmtClock(m.timeEnd)}` : '';
  return [m.pattern, time].filter(Boolean).join(' ') || 'time to be announced';
}

function credits(c) {
  const mins = c.enrollGroups.map((g) => g.unitsMinimum);
  const maxs = c.enrollGroups.map((g) => g.unitsMaximum);
  if (!mins.length) return null;
  const lo = Math.min(...mins);
  const hi = Math.max(...maxs);
  return lo === hi ? String(lo) : `${lo}-${hi}`;
}

const allSections = (c) => c.enrollGroups.flatMap((g) => g.classSections || []);

function summary(c, roster) {
  const sections = allSections(c);
  const primary = sections.filter((s) => s.ssrComponent === (c.enrollGroups[0]?.componentsRequired?.[0] || s.ssrComponent));
  const counts = {};
  for (const s of sections) {
    const k = STATUS[s.openStatus] || 'unknown';
    counts[k] = (counts[k] || 0) + 1;
  }
  const meets = uniq(primary.flatMap((s) => s.meetings.map((m) => `${s.ssrComponent} ${meetingText(m)}`)));
  return {
    course: `${c.subject} ${c.catalogNbr}`,
    title: c.titleLong || c.titleShort,
    credits: credits(c),
    instructors: uniq(sections.flatMap((s) => s.meetings.flatMap((m) => instructorNames(m.instructors)))).slice(0, 6),
    meets: meets.slice(0, 4),
    ...(meets.length > 4 ? { more_meeting_patterns: meets.length - 4 } : {}),
    sections: counts,
    ...(c.description ? { description: truncate(c.description, 220) } : {}),
    url: `https://classes.cornell.edu/browse/roster/${roster}/class/${c.subject}/${c.catalogNbr}`,
  };
}

const MAX_SECTIONS = 40;

function detail(c, roster) {
  const sections = [];
  c.enrollGroups.forEach((g, gi) => {
    for (const s of g.classSections || []) {
      sections.push({
        section: `${s.ssrComponent} ${s.section}`,
        class_number: s.classNbr,
        ...(c.enrollGroups.length > 1 ? { enroll_group: gi + 1 } : {}),
        status: STATUS[s.openStatus] || 'unknown',
        meetings: s.meetings.map((m) => ({
          when: meetingText(m),
          dates: `${fmtDate(m.startDt)} to ${fmtDate(m.endDt)}`,
          instructors: instructorNames(m.instructors),
          ...(m.meetingTopicDescription ? { topic: m.meetingTopicDescription } : {}),
        })),
        mode: s.instrModeDescr,
        ...(s.locationDescr && s.location !== 'ITH' ? { location: s.locationDescr } : {}),
        ...(s.topicDescription ? { topic: s.topicDescription } : {}),
        ...(s.addConsent && s.addConsent !== 'N' ? { consent: s.addConsentDescr } : {}),
        ...(s.notes?.length ? { notes: s.notes.map((n) => truncate(n.descrlong, 240)) } : {}),
      });
    }
  });
  const g0 = c.enrollGroups[0] || {};
  const text = (k, label) => (c[k] ? { [label]: truncate(c[k], 400) } : {});
  return {
    course: `${c.subject} ${c.catalogNbr}`,
    title: c.titleLong || c.titleShort,
    roster,
    credits: credits(c),
    grading: g0.gradingBasisLong || null,
    ...(g0.sessionLong ? { session: `${g0.sessionLong} (${fmtDate(g0.sessionBeginDt)} to ${fmtDate(g0.sessionEndDt)})` } : {}),
    required_components: g0.componentsRequired || [],
    ...(g0.componentsOptional?.length ? { optional_components: g0.componentsOptional } : {}),
    ...(c.description ? { description: truncate(c.description, 1200) } : {}),
    ...text('catalogPrereq', 'prerequisites'),
    ...text('catalogCoreq', 'corequisites'),
    ...text('catalogPrereqCoreq', 'prerequisites_or_corequisites'),
    ...text('catalogForbiddenOverlaps', 'forbidden_overlaps'),
    ...text('catalogPermission', 'permission'),
    ...text('catalogEnrollmentPriority', 'enrollment_priority'),
    ...text('catalogWhenOffered', 'when_offered'),
    ...text('catalogDistr', 'distribution'),
    ...text('catalogFee', 'fee'),
    ...text('catalogComments', 'comments'),
    ...(c.catalogOutcomes?.length ? { outcomes: c.catalogOutcomes.slice(0, 6).map((o) => truncate(o, 200)) } : {}),
    ...(c.crseAttrValueGroups?.length ? { attributes: c.crseAttrValueGroups.map((a) => `${a.attrDescr}: ${a.crseAttrValues}`) } : {}),
    ...(g0.simpleCombinations?.length ? { cross_listed_with: g0.simpleCombinations.map((x) => `${x.subject} ${x.catalogNbr}`) } : {}),
    ...(c.lastTermsOffered ? { last_terms_offered: c.lastTermsOffered } : {}),
    sections: sections.slice(0, MAX_SECTIONS),
    ...(sections.length > MAX_SECTIONS ? { sections_not_shown: sections.length - MAX_SECTIONS } : {}),
    status_note: 'Section status (open, closed, waitlist) is as published by the Class Roster; it carries no seat counts and can lag Student Center. Rooms are not in the public feed.',
    url: `https://classes.cornell.edu/browse/roster/${roster}/class/${c.subject}/${c.catalogNbr}`,
  };
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export async function classesRosters(args = {}) {
  const rosters = await loadRosters();
  const current = currentSlug();
  const shown = args.all ? rosters : rosters.slice(-9);
  return {
    default_roster: rosters.find((r) => r.default)?.slug || null,
    in_session_now: rosters.some((r) => r.slug === current) ? current : null,
    rosters: shown.map((r) => ({ roster: r.slug, name: r.name })).reverse(),
    ...(args.all ? {} : { note: `Most recent ${shown.length} of ${rosters.length}; set all to list every roster back to ${rosters[0]?.name}.` }),
    source: 'https://classes.cornell.edu',
  };
}

export async function classesSubjects(args = {}) {
  const roster = await resolveRoster(args.roster);
  let subjects = await loadSubjects(roster.slug);
  if (args.query) {
    const q = String(args.query);
    const code = q.toUpperCase().replace(/\s+/g, '');
    subjects = subjects
      .map((s) => ({ s, score: s.code === code ? 100 : Math.max(matchScore(q, s.name), s.code.startsWith(code) ? 50 : 0) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.s);
  }
  return {
    roster: roster.slug,
    term: roster.name,
    count: subjects.length,
    subjects: subjects.map((s) => `${s.code}: ${s.name}`),
  };
}

export async function classesSearch(args = {}) {
  const roster = await resolveRoster(args.roster);
  const subject = await resolveSubject(roster, args.subject);
  let params = '';
  if (args.query) params += `&q=${encodeURIComponent(String(args.query).trim())}`;
  if (args.level !== undefined && args.level !== null && args.level !== '') {
    const lvl = Math.floor(Number(args.level) / 1000) * 1000;
    if (!LEVELS.includes(lvl)) throw new InputError(`Level must be a course level such as 1000, 2000 ... 9000 (got "${args.level}").`);
    params += `&classLevels[]=${lvl}`;
  }
  let classes = await searchClasses(roster.slug, subject.code, params);
  if (args.instructor) {
    const want = normalize(args.instructor);
    classes = classes.filter((c) =>
      allSections(c).some((s) => s.meetings.some((m) => instructorNames(m.instructors).some((n) => normalize(n).includes(want)))),
    );
  }
  if (args.open_only) classes = classes.filter((c) => allSections(c).some((s) => s.openStatus === 'O'));
  const limit = intArg(args.limit, 20, 1, 50);
  const offset = intArg(args.offset, 0, 0, 100000);
  const page = classes.slice(offset, offset + limit);
  return {
    roster: roster.slug,
    term: roster.name,
    subject: `${subject.code}: ${subject.name}`,
    total: classes.length,
    showing: page.length ? `${offset + 1}-${offset + page.length}` : 'none',
    classes: page.map((c) => summary(c, roster.slug)),
    ...(offset + page.length < classes.length ? { next_offset: offset + page.length } : {}),
    ...(classes.length ? {} : { note: 'No classes match. Check the roster (a term may not be published yet) or loosen the filters.' }),
    source: 'https://classes.cornell.edu',
  };
}

export async function classesCourse(args = {}) {
  let subjectText = args.subject;
  let number = args.number;
  // Accept "CS 4780" or "CS4780" in either field.
  const joined = /^\s*([A-Za-z&]+)\s*-?\s*(\d{4})\s*$/.exec(String(args.course ?? args.subject ?? ''));
  if (joined && (args.course || !number)) [, subjectText, number] = joined;
  number = String(number ?? '').trim();
  if (!/^\d{4}$/.test(number)) throw new InputError('Give the course as subject and four-digit number, e.g. subject "CS", number "4780".');
  const roster = await resolveRoster(args.roster);
  const subject = await resolveSubject(roster, subjectText);
  let classes = (await searchClasses(roster.slug, subject.code, `&q=${number}`)).filter((c) => c.catalogNbr === number);
  if (!classes.length) classes = (await searchClasses(roster.slug, subject.code)).filter((c) => c.catalogNbr === number);
  if (!classes.length) {
    const near = (await searchClasses(roster.slug, subject.code, `&classLevels[]=${Math.floor(+number / 1000) * 1000}`))
      .slice(0, 12)
      .map((c) => `${c.subject} ${c.catalogNbr} ${c.titleShort}`);
    throw new InputError(
      `${subject.code} ${number} is not offered in ${roster.name} (${roster.slug}). Try another roster (classes_rosters lists them).${near.length ? ` Same level this term: ${near.join('; ')}.` : ''}`,
    );
  }
  return detail(classes[0], roster.slug);
}

export const _internal = { currentSlug, summary, detail, meetingText, fmtDate };
