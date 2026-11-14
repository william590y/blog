#!/usr/bin/env node
// Tests for the Cornell campus MCP server. No dependencies; Node 18+.
//
//   node cornell_mcp/test/run.mjs            unit tests on recorded fixtures, then every tool live
//   node cornell_mcp/test/run.mjs --unit     fixtures only (no network)
//   node cornell_mcp/test/run.mjs --live     live sources only
//
// Live eBird calls run only when EBIRD_API_KEY is set in the environment; without it the eBird
// tools are checked for their "not configured" answer and the live calls are reported as skipped.
// A deployed server is checked with cornell_mcp/test/e2e.sh <url>.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { onRequest } from '../../functions/mcp.js';
import { _resetCache, easternToEpoch } from '../lib/util.mjs';
import { classesCourse, classesRosters, classesSearch, classesSubjects, _internal as classesInt } from '../lib/classes.mjs';
import { libraryHours } from '../lib/library.mjs';
import { NOT_BOOKED, libraryRoomBookingLink, libraryRoomsAvailability, libraryRoomsList } from '../lib/rooms.mjs';
import { NOT_REQUESTED, campusRoomBookingLink } from '../lib/spaces25.mjs';
import { eventsCategories, eventsDetail, eventsSearch } from '../lib/events.mjs';
import { cugirDataset, cugirSearch, _internal as cugirInt } from '../lib/cugir.mjs';
import { EBIRD_NOT_CONFIGURED, ebirdHotspots, ebirdRecentObservations, ebirdSpecies, _internal as ebirdInt } from '../lib/ebird.mjs';
import { tcatAlerts, tcatDepartures, tcatStopSearch } from '../lib/tcat.mjs';
import { weatherIthaca } from '../lib/weather.mjs';
import { academicCalendar, _internal as calendarInt } from '../lib/calendar.mjs';
import { campusPlaceSearch } from '../lib/places.mjs';
import { gymOccupancy } from '../lib/gym.mjs';

const FIX = fileURLToPath(new URL('./fixtures/', import.meta.url));
const fixture = (name) => readFileSync(FIX + name, 'utf8');

const flags = new Set(process.argv.slice(2));
const runUnit = !flags.has('--live');
const runLive = !flags.has('--unit');

const tally = { unit: [0, 0], live: [0, 0], skipped: 0 };
let section = 'unit';
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    tally[section][0] += 1;
    console.log(`  ok    ${name}`);
  } catch (err) {
    tally[section][1] += 1;
    failures.push(`${section}: ${name}: ${err.message}`);
    console.log(`  FAIL  ${name}\n        ${err.message}`);
  }
}
function skip(name, why) {
  tally.skipped += 1;
  console.log(`  skip  ${name} (${why})`);
}
function ok(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}
function eq(a, b, msg) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg || 'not equal'}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}
async function throwsInput(fn, re) {
  try {
    await fn();
  } catch (err) {
    ok(err.constructor.name === 'InputError', `expected InputError, got ${err.constructor.name}: ${err.message}`);
    if (re) ok(re.test(err.message), `message "${err.message}" does not match ${re}`);
    return;
  }
  throw new Error('expected an InputError, but the call succeeded');
}

// ---------------------------------------------------------------------------
// Unit tests: the tool functions run against recorded responses through a stubbed fetch.
// ---------------------------------------------------------------------------

const realFetch = globalThis.fetch;
const requests = [];

/** [url substring, fixture file | (url) => Response] in match order. */
const ROUTES = [
  ['classes.cornell.edu/api/2.0/config/rosters.json', 'classes_rosters.json'],
  ['classes.cornell.edu/api/2.0/config/subjects.json', 'classes_subjects.json'],
  ['subject=MATH', () => new Response(JSON.stringify({ status: 'error', message: 'Not Found' }), { status: 404 })],
  ['classes.cornell.edu/api/2.0/search/classes.json', 'classes_search.json'],
  ['api3.libcal.com/api_hours_grid.php', 'libcal_grid.json'],
  ['spaces.library.cornell.edu/allspaces', 'libcal_allspaces.html'],
  ['spaces.library.cornell.edu/spaces/availability/grid', 'libcal_roomgrid.json'],
  ['spaces.library.cornell.edu/space/', 'libcal_space.html'],
  ['events.cornell.edu/api/2/events/filters', 'events_filters.json'],
  ['events.cornell.edu/api/2/events/36798930780424', 'events_event.json'],
  ['events.cornell.edu/api/2/events/123', () => new Response('{"status":"error","code":"not_found"}', { status: 404 })],
  ['events.cornell.edu/api/2/events', 'events_list.json'],
  ['cugir.library.cornell.edu/catalog.json', 'cugir_search.json'],
  ['cugir.library.cornell.edu/catalog/cugir-007879/raw', 'cugir_raw.json'],
  ['cugir.library.cornell.edu/catalog/', () => new Response('{"status":404,"error":"Not Found"}', { status: 404 })],
  ['api.ebird.org/v2/ref/hotspot/geo', 'ebird_hotspots.json'],
  ['api.ebird.org/v2/product/spplist/', () => new Response('["norcar","blujay","amecro"]')],
  ['api.ebird.org/v2/ref/taxonomy/ebird', 'ebird_taxonomy.json'],
  ['api.ebird.org/v2/data/obs/', 'ebird_obs.json'],
  ['InfoPoint/rest/Stops/GetAllStops', 'tcat_stops.json'],
  ['InfoPoint/rest/Routes/GetVisibleRoutes', 'tcat_routes.json'],
  ['InfoPoint/rest/StopDepartures/Get/1512', 'tcat_departures.json'],
  ['InfoPoint/rest/StopDepartures/Get/', () => new Response('[]')],
  ['InfoPoint/rest/PublicMessages/GetCurrentMessages', 'tcat_messages.json'],
  ['api.weather.gov/stations/KITH/observations/latest', 'nws_observation.json'],
  ['api.weather.gov/gridpoints/', 'nws_forecast.json'],
  ['api.weather.gov/alerts/active', 'nws_alerts.json'],
  ['registrar.cornell.edu/academic-calendar', 'academic_calendar.html'],
  ['cornell.edu/about/maps/data.cfm', 'map_locations.json'],
];

function stubFetch() {
  globalThis.fetch = async (url, init = {}) => {
    const u = decodeURIComponent(String(url));
    requests.push({ url: u, headers: init.headers || {}, method: init.method || 'GET', body: init.body || null });
    const route = ROUTES.find(([part]) => u.includes(part));
    if (!route) return new Response('no fixture for this URL', { status: 599 });
    return typeof route[1] === 'function' ? route[1](u) : new Response(fixture(route[1]));
  };
}

// Sat, Nov 14 2026, 10:30am in Ithaca: inside the fixtures' week.
const NOW = easternToEpoch(2026, 11, 14, 10, 30);

async function unitTests() {
  console.log('\nUnit tests (recorded fixtures, no network)');
  stubFetch();
  _resetCache();

  // ---- Class Roster ----
  await test('classes_rosters: default roster and newest first', async () => {
    const r = await classesRosters({});
    eq(r.default_roster, 'SP27');
    eq(r.rosters[0].roster, 'SP27');
    ok(r.rosters.some((x) => x.roster === 'FA26' && x.name === 'Fall 2026'));
  });
  await test('classes: term in session by date', () => {
    eq(classesInt.currentSlug(easternToEpoch(2026, 11, 14, 12)), 'FA26');
    eq(classesInt.currentSlug(easternToEpoch(2027, 1, 10, 12)), 'WI27');
    eq(classesInt.currentSlug(easternToEpoch(2027, 3, 1, 12)), 'SP27');
    eq(classesInt.currentSlug(easternToEpoch(2027, 7, 4, 12)), 'SU27');
  });
  await test('classes_subjects: filter by word', async () => {
    const r = await classesSubjects({ query: 'computer', roster: 'FA26' });
    eq(r.roster, 'FA26');
    ok(r.subjects.includes('CS: Computer Science'), JSON.stringify(r.subjects));
    ok(!r.subjects.some((s) => s.startsWith('MUSIC')));
  });
  await test('classes_search: summary, roster forms, no NetIDs', async () => {
    const r = await classesSearch({ subject: 'Computer Science', roster: 'fall 2026', query: 'machine learning' });
    eq(r.roster, 'FA26');
    eq(r.subject, 'CS: Computer Science');
    eq(r.total, 2);
    const c = r.classes[0];
    eq(c.course, 'CS 3780');
    eq(c.credits, '4');
    eq(c.meets, ['LEC TR 1:25pm-2:40pm']);
    eq(c.sections, { open: 2 });
    ok(c.instructors.length >= 1 && c.instructors.every((n) => / /.test(n)));
    ok(!JSON.stringify(r).includes('netid'), 'NetID field leaked');
    ok(requests.some((q) => q.url.includes('roster=FA26&subject=CS&q=machine learning')), 'unexpected request URL');
  });
  await test('classes_search: instructor filter, level validation, empty result', async () => {
    const none = await classesSearch({ subject: 'CS', roster: 'FA26', instructor: 'nobody at all' });
    eq(none.total, 0);
    ok(none.note);
    await throwsInput(() => classesSearch({ subject: 'CS', roster: 'FA26', level: 12 }), /level/i);
    const empty = await classesSearch({ subject: 'MATH', roster: 'FA26' }); // the API's 404 = no classes
    eq(empty.total, 0);
  });
  await test('classes_search: bad subject and bad roster are input errors', async () => {
    await throwsInput(() => classesSearch({ roster: 'FA26' }), /subject is required/i);
    await throwsInput(() => classesSearch({ subject: 'zzzz', roster: 'FA26' }), /No subject matches/);
    await throwsInput(() => classesSearch({ subject: 'comp', roster: 'FA26' }), /Several subjects match/);
    await throwsInput(() => classesSearch({ subject: 'CS', roster: 'FA99' }), /No roster matches/);
  });
  await test('classes_course: sections, times, status, prerequisites', async () => {
    const r = await classesCourse({ subject: 'cs 3780', roster: 'FA26' });
    eq(r.course, 'CS 3780');
    eq(r.sections.length, 2);
    eq(r.sections[0].section, 'LEC 001');
    eq(r.sections[0].status, 'open');
    eq(r.sections[0].meetings[0].when, 'TR 1:25pm-2:40pm');
    eq(r.sections[0].meetings[0].dates, '2026-08-24 to 2026-12-07');
    eq(r.sections[1].meetings[0].when, 'time to be announced');
    ok(/CS 2110/.test(r.prerequisites));
    eq(r.cross_listed_with, ['CS 5780']);
    await throwsInput(() => classesCourse({ subject: 'CS', number: '9999', roster: 'FA26' }), /not offered/);
    await throwsInput(() => classesCourse({ subject: 'CS', number: '37', roster: 'FA26' }), /four-digit/);
  });

  // ---- Library ----
  await test('library_hours: open now, closing time, free-text hours, junk rows dropped', async () => {
    const r = await libraryHours({}, NOW);
    eq(r.date, '2026-11-14');
    const by = Object.fromEntries(r.libraries.map((l) => [l.name, l]));
    eq(by['Olin Library'].hours, '10am - 6pm');
    eq(by['Olin Library'].open_now, true);
    eq(by['Olin Library'].closes, '6:00pm');
    eq(by['Uris Library'].open_now, false);
    eq(by['Uris Library'].opens, '12:00pm');
    eq(by['Engineering Library card access'].open_now, true);
    eq(by['Africana Library'].open_now, false);
    eq(by['Law Library'].open_now, null);
    ok(!('Testing Library' in by), 'a location with no hours set should be dropped');
    ok(!by['Olin Library'].services, 'services only on request');
    eq(r.libraries[0].open_now, true, 'open libraries sort first');
  });
  await test('library_hours: one library with services and the week; before opening', async () => {
    const r = await libraryHours({ library: 'olin' }, easternToEpoch(2026, 11, 14, 8, 0));
    eq(r.libraries.length, 1);
    eq(r.libraries[0].open_now, false);
    eq(r.libraries[0].opens, '10:00am');
    ok(r.libraries[0].services.some((s) => /Libe Cafe/.test(s.name)));
    ok(Object.keys(r.libraries[0].next_days).length === 0 || r.libraries[0].next_days['2026-11-15'] !== undefined);
    const both = await libraryHours({ library: 'olin uris' }, NOW);
    eq(both.libraries.map((l) => l.name).sort(), ['Olin Library', 'Uris Library']);
    const cafe = await libraryHours({ library: 'libe cafe' }, NOW);
    eq(cafe.libraries[0].part_of, 'Olin Library');
  });
  await test('library_hours: unknown library, past date, far date', async () => {
    const r = await libraryHours({ library: 'hogwarts' }, NOW);
    ok(/No library matches/.test(r.error) && r.libraries.length > 3);
    await throwsInput(() => libraryHours({ date: '2026-11-01' }, NOW), /today and future/);
    await throwsInput(() => libraryHours({ date: '2028-01-01' }, NOW), /six months/);
  });

  // ---- Rooms: LibCal study rooms ----
  const MON = easternToEpoch(2026, 11, 14, 10, 30); // two days before the fixture's Monday grid
  await test('library_rooms_list: rooms, filters, one room with details', async () => {
    const r = await libraryRoomsList({});
    eq(r.count, 5);
    eq(r.locations, ['Olin & Uris Libraries', 'Catherwood Library', 'Mann Library', 'Carpenter Hall']);
    const olin = await libraryRoomsList({ location: 'uris' });
    eq(olin.rooms.map((x) => x.name).sort(), ['Olin 302', 'Uris 4B02']);
    eq((await libraryRoomsList({ min_capacity: 6 })).rooms.map((x) => x.name).sort(), ['Group Room 260', 'Olin 302']);
    eq((await libraryRoomsList({ category: 'individual' })).count, 2);
    const one = await libraryRoomsList({ room: 'uris 4b02' });
    eq(one.rooms[0].room_id, 5647);
    eq(one.rooms[0].capacity, 5);
    ok(/Cocktail Lounge/.test(one.rooms[0].description));
    eq(one.rooms[0].features, ['Accessible Seat / Space', 'Power Available']);
    await throwsInput(() => libraryRoomsList({ location: 'atlantis' }), /No bookable library location/);
    await throwsInput(() => libraryRoomsList({ room: 'ballroom' }), /No bookable library room/);
  });
  await test('library_rooms_availability: free ranges merged, wanted time, request shape', async () => {
    const r = await libraryRoomsAvailability({ date: '2026-11-16', location: 'olin' }, MON);
    const by = Object.fromEntries(r.rooms.map((x) => [x.name, x]));
    eq(by['Olin 302'].free, ['10:00am-1:00pm', '6:30pm-12:00am']);
    eq(by['Uris 4B02'].free, ['12:00am-6:00am', '8:00am-12:30pm', '2:15pm-5:00pm', '7:00pm-12:00am']);
    ok(/Nothing is reserved/.test(r.reminder));
    const q = requests.filter((x) => x.url.includes('/spaces/availability/grid')).at(-1);
    eq(q.method, 'POST');
    ok(q.body.includes('lid=94') && q.body.includes('start=2026-11-16') && q.body.includes('end=2026-11-17'), q.body);
    eq(q.headers.referer, 'https://spaces.library.cornell.edu/allspaces');
    ok(!('cookie' in q.headers) && !('authorization' in q.headers), 'no credentials are ever sent');
    const w = await libraryRoomsAvailability({ date: '2026-11-16', location: 'olin', start: '11am', duration_minutes: 90 }, MON);
    eq(w.rooms.map((x) => x.name).sort(), ['Olin 302', 'Uris 4B02']);
    const w2 = await libraryRoomsAvailability({ date: '2026-11-16', location: 'olin', start: '3pm', duration_minutes: 120 }, MON);
    eq(w2.rooms.map((x) => x.name), ['Uris 4B02']);
    const none = await libraryRoomsAvailability({ date: '2026-11-16', location: 'olin', start: '1pm', duration_minutes: 120 }, MON);
    eq(none.count, 0);
    ok(/No matching room is free/.test(none.note));
    await throwsInput(() => libraryRoomsAvailability({ date: '2026-11-01' }, MON), /today and future/);
    await throwsInput(() => libraryRoomsAvailability({ date: '2026-11-16', start: 'teatime' }, MON), /Could not understand start/);
  });
  await test('library_rooms_availability: past times today are not offered', async () => {
    const r = await libraryRoomsAvailability({ date: '2026-11-16', room: 'Olin 302' }, easternToEpoch(2026, 11, 16, 12, 0));
    eq(r.rooms[0].free, ['11:45am-1:00pm', '6:30pm-12:00am']);
  });
  await test('library_room_booking_link: a link and steps, never a booking', async () => {
    const before = requests.length;
    const r = await libraryRoomBookingLink({ room: 'Olin 302', date: '2026-11-16', start: '11am', duration_minutes: 60 }, MON);
    eq(r.status, NOT_BOOKED);
    ok(/^NOT BOOKED/.test(r.status));
    eq(r.link, 'https://spaces.library.cornell.edu/space/3845?date=2026-11-16');
    eq(r.request.time, '11:00am-12:00pm');
    ok(/^Free for 11:00am-12:00pm/.test(r.availability_check));
    ok(/Prepared, not booked/.test(r.summary) && r.steps.some((x) => /NetID/.test(x)));
    const busy = await libraryRoomBookingLink({ room: '3845', date: '2026-11-16', start: '2pm' }, MON);
    ok(/^NOT free/.test(busy.availability_check) && /10:00am-1:00pm/.test(busy.availability_check));
    // Only reads: the room list, the room page and the public grid. No cart, no login, no submission.
    for (const q of requests.slice(before)) {
      ok(/\/allspaces$|\/space\/\d+$|\/spaces\/availability\/grid$/.test(q.url), `unexpected request ${q.url}`);
      ok(!/createcart|\/ajax\/space\/times|login|libauth|process_/.test(q.url + (q.body || '')), `a booking endpoint was called: ${q.url}`);
    }
    await throwsInput(() => libraryRoomBookingLink({ room: 'Individual Study Room', date: '2026-11-16' }, MON), /matches several rooms/);
    await throwsInput(() => libraryRoomBookingLink({ date: '2026-11-16' }, MON), /room is required/);
    await throwsInput(() => libraryRoomBookingLink({ room: 'Olin 302', date: '2026-11-01' }, MON), /today or a future date/);
  });

  // ---- Rooms: 25Live hand-off ----
  await test('campus_room_booking_link: steps only, no request to 25Live at all', async () => {
    const before = requests.length;
    const r = await campusRoomBookingLink({ space: 'Gates Hall G01', date: '2026-11-16', start: '9:30pm', duration_minutes: 90 }, MON);
    eq(r.status, NOT_REQUESTED);
    ok(/^NOT BOOKED/.test(r.status) && /has not checked/.test(r.status));
    eq(r.link, 'https://25live.collegenet.com/pro/cornell');
    eq(r.request, { space: 'Gates Hall G01', date: '2026-11-16', time: '9:30pm-11:00pm' });
    ok(/^Not checked/.test(r.availability_check));
    ok(/Prepared, not requested/.test(r.summary) && r.steps.some((x) => /NetID/.test(x)));
    eq(requests.length, before, '25Live sits behind Cornell sign-in: the server must not call it');
    await throwsInput(() => campusRoomBookingLink({ date: '2026-11-16' }, MON), /space is required/);
    await throwsInput(() => campusRoomBookingLink({ space: 'x', date: '2026-11-01' }, MON), /today or a future date/);
    await throwsInput(() => campusRoomBookingLink({ space: 'x', date: '2026-11-16', start: 'teatime' }, MON), /Could not understand start/);
  });

  // ---- Events ----
  await test('events_search: dates, filters resolved by name, placeholder times', async () => {
    const r = await eventsSearch({ type: 'athletic', department: 'athletics', days: 2 }, NOW);
    eq(r.from, '2026-11-14');
    eq(r.through, '2026-11-15');
    eq(r.filters, { type: 'Athletic', department: 'Athletics' });
    const u = requests.at(-1).url;
    ok(u.includes('start=2026-11-14') && u.includes('end=2026-11-16') && u.includes('type[]=4248') && u.includes('type[]=4184'), u);
    eq(r.events[0].start, 'Sat, Nov 14 (time not listed)');
    eq(r.events[1].start, 'Sat, Nov 14, 11:00am');
    eq(r.events[1].where, 'Bartels Hall');
    eq(r.total, 13);
  });
  await test('events_search: inclusive end, keyword path, bad input', async () => {
    await eventsSearch({ query: 'concert', start: '2026-12-01', end: '2026-12-03' }, NOW);
    const u = requests.at(-1).url;
    ok(u.includes('/events/search?') && u.includes('search=concert') && u.includes('end=2026-12-04'), u);
    await throwsInput(() => eventsSearch({ start: '2026-12-05', end: '2026-12-01' }, NOW), /before start/);
    await throwsInput(() => eventsSearch({ type: 'zzzz' }, NOW), /No event type matches/);
    await throwsInput(() => eventsSearch({ start: 'someday' }, NOW), /Could not understand date/);
  });
  await test('events_detail: prefers the real start over the midnight placeholder; unknown id', async () => {
    const r = await eventsDetail({ id: '36798930780424' }, easternToEpoch(2026, 11, 13, 9, 0));
    eq(r.start, 'Sat, Nov 14, 1:00pm');
    eq(r.where, 'Schoellkopf Field');
    const over = await eventsDetail({ id: '36798930780424' }, easternToEpoch(2026, 12, 1, 9, 0));
    eq(over.status, 'This event is over.');
    await throwsInput(() => eventsDetail({ id: '123' }, NOW), /No event with id/);
    await throwsInput(() => eventsDetail({ id: 'x' }, NOW), /numeric/);
  });
  await test('events_categories: lists and filters', async () => {
    const t = await eventsCategories({});
    ok(t.names.includes('Athletic'));
    const d = await eventsCategories({ kind: 'departments', query: 'music' });
    ok(d.names.length >= 1 && d.names.every((n) => /music/i.test(n)));
    await throwsInput(() => eventsCategories({ kind: 'colour' }), /kind must be/);
  });

  // ---- CUGIR ----
  await test('cugir_search: rows from the GeoBlacklight JSON', async () => {
    const r = await cugirSearch({ query: 'tompkins roads', limit: 2 });
    eq(r.total, 3);
    eq(r.datasets[0].id, 'cugir-007879');
    eq(r.datasets[0].year, '2005');
    ok(/Road Centerlines/.test(r.datasets[0].title));
  });
  await test('cugir_dataset: downloads, bounding box, services; id forms; unknown id', async () => {
    const r = await cugirDataset({ id: 'https://cugir.library.cornell.edu/catalog/cugir-007879' });
    eq(r.format, 'Shapefile');
    eq(r.downloads[0].url, 'https://cugir-data.s3.amazonaws.com/00/78/79/cugir-007879.zip');
    eq(r.bounding_box, { west: -76.696426, east: -76.24689, north: 42.62742, south: 42.262786 });
    eq(r.web_services.layer, 'cugir007879');
    eq((await cugirDataset({ id: '7879' })).id, 'cugir-007879');
    eq(cugirInt.parseEnvelope('nonsense'), null);
    await throwsInput(() => cugirDataset({ id: 'cugir-999999' }), /No CUGIR dataset/);
    await throwsInput(() => cugirDataset({ id: 'roads' }), /dataset id/);
  });

  // ---- eBird ----
  await test('ebird: not configured without a key, and no request is made', async () => {
    const before = requests.length;
    for (const fn of [ebirdRecentObservations, ebirdHotspots, (a, e) => ebirdSpecies({ name: 'cardinal' }, e)]) {
      await throwsInput(() => fn({}, {}), /eBird is not configured/);
      await throwsInput(() => fn({}, { EBIRD_API_KEY: '   ' }), /EBIRD_API_KEY/);
    }
    eq(requests.length, before, 'no network request without a key');
  });
  const ENV = { EBIRD_API_KEY: 'test-key-not-real' };
  await test('ebird_recent_observations: key goes in a header, repeats collapse, private places hidden', async () => {
    const r = await ebirdRecentObservations({}, ENV);
    const q = requests.at(-1);
    ok(q.url.includes('/data/obs/geo/recent?lat=42.4470&lng=-76.4832&dist=5&back=3'), q.url);
    eq(q.headers['x-ebirdapitoken'], 'test-key-not-real');
    ok(!q.url.includes('test-key-not-real'), 'the key must never be in a URL');
    eq(r.observations.length, 3);
    const card = r.observations.find((o) => o.code === 'norcar');
    eq(card.reports, 2);
    eq(card.when, 'Sat, Nov 14, 7:35am');
    const crow = r.observations.find((o) => o.code === 'amecro');
    eq(crow.count, 'present');
    eq(crow.unconfirmed, true);
    ok(!JSON.stringify(r).includes('Example St'), 'a personal location name leaked');
  });
  await test('ebird_recent_observations: hotspot by name, county, notable, species, lat,lng', async () => {
    const h = await ebirdRecentObservations({ location: 'sapsucker woods', notable: true }, ENV);
    eq(h.location, 'Sapsucker Woods');
    ok(requests.at(-1).url.includes('/data/obs/L99381/recent/notable?back=3&detail=simple'), requests.at(-1).url);
    await ebirdRecentObservations({ location: 'Tompkins County', days_back: 99 }, ENV);
    ok(requests.at(-1).url.includes('/data/obs/US-NY-109/recent?back=30'), requests.at(-1).url);
    const s = await ebirdRecentObservations({ location: '42.48,-76.45', species: 'blue jay', radius_km: 2 }, ENV);
    ok(requests.at(-1).url.includes('/data/obs/geo/recent/blujay?lat=42.4800&lng=-76.4500&dist=2'), requests.at(-1).url);
    ok(/Blue Jay/.test(s.kind));
    await throwsInput(() => ebirdRecentObservations({ location: 'atlantis marsh' }, ENV), /No eBird hotspot/);
    eq(ebirdInt.parseLatLng('95,10'), null);
  });
  await test('ebird_hotspots: distance, sort, filter', async () => {
    const r = await ebirdHotspots({}, ENV);
    eq(r.hotspots[0].name, 'Stewart Park');
    ok(r.hotspots.every((h) => h.km_away > 0 && h.km_away < 10));
    const d = await ebirdHotspots({ sort: 'distance' }, ENV);
    eq(d.hotspots[0].name, 'Beebe Lake');
    const q = await ebirdHotspots({ query: 'sapsucker' }, ENV);
    eq(q.hotspots.map((h) => h.id), ['L99381']);
    await throwsInput(() => ebirdHotspots({ near: 'the moon' }, ENV), /near must be/);
  });
  await test('ebird_species: by name with recent county sightings; no match', async () => {
    const r = await ebirdSpecies({ name: 'cardinal' }, ENV);
    eq(r.matches[0].code, 'norcar');
    eq(r.matches[0].scientific_name, 'Cardinalis cardinalis');
    ok(r.recent_in_county.sightings.length >= 1);
    const none = await ebirdSpecies({ name: 'dodo', include_recent: false }, ENV);
    eq(none.matches, []);
    await throwsInput(() => ebirdSpecies({}, ENV), /name is required/);
  });

  // ---- TCAT ----
  await test('tcat_stop_search: by name and by distance', async () => {
    const r = await tcatStopSearch({ query: 'sage hall' });
    eq(r.stops.map((s) => s.stop_id), [1534]);
    const n = await tcatStopSearch({ near: '42.4470,-76.4832', limit: 2 });
    eq(n.stops.length, 2);
    ok(n.stops[0].meters_away <= n.stops[1].meters_away);
    await throwsInput(() => tcatStopSearch({}), /Give a query/);
    await throwsInput(() => tcatStopSearch({ near: 'here' }), /lat,lng/);
    eq((await tcatStopSearch({ query: 'zzzz' })).count, 0);
  });
  await test('tcat_departures: times, minutes, route filter, unknown stop', async () => {
    const now = easternToEpoch(2026, 11, 14, 6, 38);
    const r = await tcatDepartures({ stop: '1512' }, now);
    const d = r.stops[0].departures;
    eq(d[0], { route: '30', to: '30W Mall via West Campus', departs: '7:08am', in_minutes: 30, status: 'scheduled (no live estimate yet)' });
    eq(d.length, 3);
    eq((await tcatDepartures({ stop: '1512', route: '10' }, now)).stops[0].departures, []);
    const later = await tcatDepartures({ stop: 'baker flagpole' }, easternToEpoch(2026, 11, 14, 7, 30));
    eq(later.stops[0].departures.length, 2, 'departed buses are dropped');
    await throwsInput(() => tcatDepartures({ stop: 'nowhere at all' }, now), /No TCAT stop/);
    await throwsInput(() => tcatDepartures({}, now), /stop is required/);
  });
  await test('tcat_alerts: current message, expiry, route filter', async () => {
    const r = await tcatAlerts({}, NOW);
    eq(r.count, 1);
    eq(r.alerts[0].effect, 'Detour');
    ok(/Route 92/.test(r.alerts[0].message));
    ok(r.routes.includes('30: Ithaca Mall via CU'), JSON.stringify(r.routes));
    eq((await tcatAlerts({ route: '92' }, NOW)).count, 1);
    eq((await tcatAlerts({ route: '30' }, NOW)).count, 0);
    eq((await tcatAlerts({}, easternToEpoch(2027, 3, 1, 12))).count, 0, 'expired alerts are dropped');
  });

  // ---- Weather, calendar, places ----
  await test('weather_ithaca: unit conversion, forecast, alerts', async () => {
    const r = await weatherIthaca({ periods: 2 }, NOW);
    eq(r.now.temperature_f, 34);
    eq(r.now.temperature_c, 1);
    eq(r.now.feels_like_f, 27);
    eq(r.now.wind, 'W 8 mph');
    eq(r.now.conditions, 'Light Snow');
    eq(r.forecast.length, 2);
    eq(r.forecast[0].name, 'Today');
    eq(r.forecast[0].temperature_f, 39);
    eq(r.alerts[0].event, 'Winter Weather Advisory');
    ok(requests.some((q) => q.url.includes('api.weather.gov') && q.headers['user-agent'] === 'cornell-campus-mcp/0.3'), 'generic User-Agent expected');
  });
  await test('academic_calendar: rows, ranges across months, search, window', async () => {
    const rows = calendarInt.parseCalendar(fixture('academic_calendar.html'));
    eq(rows.length, 17);
    const r = await academicCalendar({ query: 'thanksgiving' }, NOW);
    eq(r.events, [{ date: '2026-11-25 to 2026-11-29', time: 'Nov 25 12:00 AM – Nov 29 11:59 PM', title: 'Thanksgiving Break / No classes' }]);
    const up = await academicCalendar({ limit: 3 }, NOW);
    eq(up.events.length, 3);
    ok(up.events.every((e) => e.date.slice(-10) >= '2026-11-14'), 'upcoming only by default');
    const past = await academicCalendar({ query: 'enrollment begins for seniors' }, NOW);
    eq(past.events[0].past, true);
    eq((await academicCalendar({ from: '2026-12-11', to: '2026-12-19', query: 'exam' }, NOW)).events[0].title, 'Fall 2026: Final exams');
    eq(calendarInt.parseDates('Dec 23 – Jan 4', 11, 2026), { start: '2026-12-23', end: '2027-01-04' });
    eq(calendarInt.parseDates('Mar 27 – Apr 4', 2, 2027), { start: '2027-03-27', end: '2027-04-04' });
    eq(calendarInt.parseDates('Nov 11', 10, 2026), { start: '2026-11-11', end: '2026-11-11' });
    eq((await academicCalendar({ query: 'zzzz' }, NOW)).total, 0);
    await throwsInput(() => academicCalendar({ from: '2026-12-10', to: '2026-12-01' }, NOW), /before from/);
  });
  await test('campus_place_search: nickname, category, errors', async () => {
    const r = await campusPlaceSearch({ query: 'gates hall' });
    eq(r.places[0].name, 'Bill and Melinda Gates Hall');
    eq(r.places[0].address, '107 Hoy Rd, Ithaca, NY 14853');
    ok(r.places[0].directions.includes('42.44495,-76.480807'));
    const p = await campusPlaceSearch({ category: 'parking' });
    eq(p.places.map((x) => x.name), ['A-Lot Staff Parking']);
    await throwsInput(() => campusPlaceSearch({}), /Give a query/);
    await throwsInput(() => campusPlaceSearch({ category: 'volcanoes' }), /No map category/);
    eq((await campusPlaceSearch({ query: 'zzzz' })).total, 0);
  });

  // ---- Server ----
  await test('gym_occupancy: a closed gym with a stale count reads "closed"', async () => {
    _resetCache();
    globalThis.fetch = async (url) => {
      if (String(url).includes('goboardapi')) {
        return new Response(JSON.stringify([{ LocationName: 'Noyes Fitness Center', LastCount: 27, TotalCapacity: 65, IsClosed: true, LastUpdatedDateAndTime: '2020-01-01T22:09:17' }]));
      }
      return new Response('', { status: 503 });
    };
    const r = await gymOccupancy({});
    eq(r.facilities[0].level, 'closed');
    eq(r.facilities[0].count, 27);
    ok(r.facilities[0].note);
    stubFetch();
    _resetCache();
  });
  await test('server: initialize, tools/list (30 tools, closed schemas), unknown tool, errors', async () => {
    const init = await rpc('initialize', { protocolVersion: '2025-06-18' });
    eq(init.result.serverInfo.version, '0.3.0');
    ok(/classes_search/.test(init.result.instructions) && /eBird/.test(init.result.instructions));
    const list = await rpc('tools/list');
    const names = list.result.tools.map((t) => t.name);
    eq(names.length, 30);
    eq(new Set(names).size, 30);
    for (const old of ['dining_open_now', 'dining_menus', 'dining_eatery', 'dining_menu_search', 'dining_list_eateries', 'gym_occupancy', 'gym_schedule']) {
      ok(names.includes(old), `existing tool ${old} must stay`);
    }
    for (const t of list.result.tools) {
      ok(t.description.length > 40 && t.description.length < 800, `${t.name}: description length ${t.description.length}`);
      eq(t.inputSchema.type, 'object');
      eq(t.annotations.readOnlyHint, true);
      for (const req of t.inputSchema.required || []) ok(req in t.inputSchema.properties, `${t.name}: required ${req} not a property`);
      for (const [k, v] of Object.entries(t.inputSchema.properties)) ok(v.type && v.description, `${t.name}.${k} needs a type and description`);
    }
    for (const t of list.result.tools.filter((x) => /booking_link$/.test(x.name))) {
      ok(/WITHOUT/.test(t.description) && /never (books|requests)/.test(t.description) && /does not book/.test(t.title), `${t.name} must say it does not book`);
    }
    ok(/cannot book/.test(init.result.instructions) && /never say a room is booked/.test(init.result.instructions));
    ok(!/25live\.collegenet\.com\/25live\/data/.test(JSON.stringify(list)), 'no 25Live data endpoint');
    const sent = JSON.stringify(list.result.tools.map((t) => t.inputSchema));
    ok(!/password|netid_password|cookie|duo|token/i.test(sent), 'no tool may accept credentials');
    const bad = await rpc('tools/call', { name: 'nope', arguments: {} });
    eq(bad.error.code, -32602);
    const nokey = await rpc('tools/call', { name: 'ebird_hotspots', arguments: {} });
    eq(nokey.result.isError, true);
    eq(nokey.result.content[0].text, EBIRD_NOT_CONFIGURED);
    const viaEnv = await rpc('tools/call', { name: 'ebird_hotspots', arguments: {} }, ENV);
    eq(viaEnv.result.isError, false, 'the key should reach the tool through context.env');
    globalThis.fetch = async () => new Response('down', { status: 503 });
    _resetCache();
    const down = await rpc('tools/call', { name: 'cugir_search', arguments: { query: 'x' } });
    eq(down.result.isError, true);
    ok(/HTTP 503/.test(down.result.content[0].text) && /cugir\.library\.cornell\.edu/.test(down.result.content[0].text), down.result.content[0].text);
    const downGym = await rpc('tools/call', { name: 'gym_schedule', arguments: {} });
    ok(/Fallback pages: https:\/\/now\.dining\.cornell\.edu/.test(downGym.result.content[0].text), 'existing fallback text must be unchanged');
  });

  globalThis.fetch = realFetch;
  _resetCache();
}

// ---------------------------------------------------------------------------
// Live tests: every tool through the JSON-RPC handler against the real sources.
// ---------------------------------------------------------------------------

let rpcId = 0;
async function rpc(method, params, env = {}) {
  const res = await onRequest({
    env,
    request: new Request('https://local.test/mcp', {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, ...(params ? { params } : {}) }),
    }),
  });
  return res.json();
}

async function call(name, args, env = {}) {
  const j = await rpc('tools/call', { name, arguments: args }, env);
  ok(j.result, `no result: ${JSON.stringify(j).slice(0, 200)}`);
  const text = j.result.content[0].text;
  ok(!j.result.isError, `tool error: ${text.slice(0, 300)}`);
  ok(text.length < 40000, `result too large for a chat model: ${text.length} chars`);
  return JSON.parse(text);
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function liveTests() {
  console.log('\nLive tests (real sources)');
  section = 'live';
  _resetCache();
  const env = process.env.EBIRD_API_KEY ? { EBIRD_API_KEY: process.env.EBIRD_API_KEY } : {};

  // Existing tools: unchanged names and shapes.
  await test('dining_open_now', async () => {
    const r = await call('dining_open_now', {});
    ok(typeof r.open_count === 'number' && Array.isArray(r.open) && Array.isArray(r.opening_soon));
  });
  await test('dining_menus', async () => {
    const r = await call('dining_menus', { date: 'tomorrow', meal: 'Dinner' });
    ok(r && typeof r === 'object' && !r.error, JSON.stringify(r).slice(0, 200));
  });
  await test('dining_eatery', async () => {
    const r = await call('dining_eatery', { name: 'Okies', include_menu: false });
    ok(/Okenshields/i.test(JSON.stringify(r)));
  });
  await test('dining_menu_search', async () => {
    const r = await call('dining_menu_search', { query: 'chicken', date: 'tomorrow' });
    ok(r && typeof r === 'object');
  });
  await test('dining_list_eateries', async () => {
    const r = await call('dining_list_eateries', { area: 'North' });
    ok(JSON.stringify(r).length > 200);
  });
  await test('gym_occupancy', async () => {
    const r = await call('gym_occupancy', {});
    ok(r.facilities.length >= 4 && r.facilities.every((f) => typeof f.count === 'number' && f.level));
  });
  await test('gym_schedule', async () => {
    const r = await call('gym_schedule', {});
    ok(r.facilities.length >= 4 && Array.isArray(r.todays_classes) && !r.warnings, JSON.stringify(r.warnings));
  });

  // Class Roster (the API asks for at most one request a second).
  let roster;
  await test('classes_rosters', async () => {
    const r = await call('classes_rosters', {});
    ok(r.default_roster && r.rosters.length >= 5);
    roster = r.in_session_now || r.default_roster;
  });
  await pause(1100);
  await test('classes_subjects', async () => {
    const r = await call('classes_subjects', { query: 'computer science', roster });
    ok(r.subjects.some((s) => s.startsWith('CS:')), JSON.stringify(r.subjects));
  });
  await pause(1100);
  let course;
  await test('classes_search', async () => {
    const r = await call('classes_search', { subject: 'CS', roster, level: 2000, limit: 5 });
    ok(r.total > 0 && r.classes.length > 0 && /^CS \d{4}$/.test(r.classes[0].course), JSON.stringify(r).slice(0, 200));
    ok(!/netid/i.test(JSON.stringify(r)));
    course = r.classes[0].course;
  });
  await pause(1100);
  await test('classes_course', async () => {
    const r = await call('classes_course', { subject: course || 'CS 2110', roster });
    ok(r.sections.length > 0 && r.sections[0].meetings.length > 0 && ['open', 'closed', 'waitlist', 'unknown'].includes(r.sections[0].status));
    ok(!/netid/i.test(JSON.stringify(r)));
  });

  // Library
  await test('library_hours', async () => {
    const r = await call('library_hours', {});
    ok(r.libraries.length >= 10 && r.libraries.some((l) => l.name === 'Olin Library') && r.libraries.every((l) => typeof l.hours === 'string'));
    const one = await call('library_hours', { library: 'Mann', date: 'tomorrow' });
    eq(one.libraries[0].name, 'Mann Library');
  });
  // Rooms
  let roomId;
  await test('library_rooms_list', async () => {
    const r = await call('library_rooms_list', {});
    ok(r.count >= 20 && r.locations.length >= 3 && r.rooms.every((x) => x.room_id && x.name && x.location), JSON.stringify(r).slice(0, 200));
    roomId = r.rooms.find((x) => /Olin \d/.test(x.name))?.room_id ?? r.rooms[0].room_id;
  });
  await test('library_rooms_availability', async () => {
    const r = await call('library_rooms_availability', { date: 'tomorrow', location: 'Mann' });
    ok(r.count > 5 && r.rooms.every((x) => Array.isArray(x.free)));
    ok(r.rooms.some((x) => x.free.length && /^\d{1,2}:\d{2}[ap]m-\d{1,2}:\d{2}[ap]m$/.test(x.free[0])), 'expected some free time in Mann tomorrow');
    const w = await call('library_rooms_availability', { date: 'tomorrow', start: '3pm', duration_minutes: 60 });
    ok(typeof w.count === 'number' && w.wanted === '3:00pm-4:00pm');
  });
  await test('library_room_booking_link', async () => {
    const r = await call('library_room_booking_link', { room: String(roomId), date: 'tomorrow', start: '3pm' });
    ok(/^NOT BOOKED/.test(r.status) && /^https:\/\/spaces\.library\.cornell\.edu\/space\/\d+\?date=\d{4}-\d{2}-\d{2}$/.test(r.link), JSON.stringify(r).slice(0, 300));
    const page = await fetch(r.link, { headers: { 'user-agent': 'cornell-campus-mcp/0.3' } });
    const html = await page.text();
    ok(page.ok && html.includes(`initialDate: '${r.request.date.replace(/-/g, '\\u002D')}'`), 'the booking page should open on the requested date');
  });
  await test('campus_room_booking_link', async () => {
    const r = await call('campus_room_booking_link', { space: 'Gates Hall G01', date: 'monday', start: '8pm' });
    ok(/^NOT BOOKED/.test(r.status) && r.link === 'https://25live.collegenet.com/pro/cornell' && /^Not checked/.test(r.availability_check));
  });

  // Events
  let eventId;
  await test('events_search', async () => {
    const r = await call('events_search', { days: 14, limit: 5 });
    ok(r.total > 0 && r.events.length > 0 && r.events[0].title && r.events[0].start && r.events[0].url, JSON.stringify(r).slice(0, 200));
    eventId = r.events[0].id;
    const typed = await call('events_search', { type: 'Lecture', days: 30, limit: 3 });
    eq(typed.filters.type, 'Lecture');
    const kw = await call('events_search', { query: 'music', days: 60, limit: 3, place: 'Bailey Hall' });
    eq(kw.filters.place, 'Bailey Hall');
  });
  await test('events_detail', async () => {
    const r = await call('events_detail', { id: eventId });
    ok(r.title && r.url);
  });
  await test('events_categories', async () => {
    const r = await call('events_categories', { kind: 'department', query: 'music' });
    ok(r.count > 0);
  });

  // CUGIR
  let dataset;
  await test('cugir_search', async () => {
    const r = await call('cugir_search', { query: 'Tompkins County roads', limit: 3 });
    ok(r.total > 0 && /^cugir-/.test(r.datasets[0].id), JSON.stringify(r).slice(0, 200));
    dataset = r.datasets[0].id;
  });
  await test('cugir_dataset', async () => {
    const r = await call('cugir_dataset', { id: dataset || 'cugir-007879' });
    ok(r.title && r.url && (r.downloads || r.web_services || r.metadata));
  });

  // eBird
  if (env.EBIRD_API_KEY) {
    await test('ebird_recent_observations', async () => {
      const r = await call('ebird_recent_observations', { days_back: 7 }, env);
      ok(Array.isArray(r.observations));
      const n = await call('ebird_recent_observations', { location: 'Tompkins County', notable: true, days_back: 14 }, env);
      ok(Array.isArray(n.observations));
    });
    await test('ebird_hotspots', async () => {
      const r = await call('ebird_hotspots', {}, env);
      ok(r.hotspots.length > 0 && r.hotspots[0].id.startsWith('L'));
    });
    await test('ebird_species', async () => {
      const r = await call('ebird_species', { name: 'northern cardinal' }, env);
      eq(r.matches[0].code, 'norcar');
    });
  } else {
    for (const name of ['ebird_recent_observations', 'ebird_hotspots', 'ebird_species']) {
      await test(`${name}: reports "not configured" without a key`, async () => {
        const j = await rpc('tools/call', { name, arguments: { name: 'cardinal' } });
        eq(j.result.isError, true);
        ok(/eBird is not configured/.test(j.result.content[0].text));
      });
      skip(`${name} against live eBird`, 'EBIRD_API_KEY is not set');
    }
  }

  // TCAT
  let stopId;
  await test('tcat_stop_search', async () => {
    const r = await call('tcat_stop_search', { query: 'Commons' });
    ok(r.count > 0 && Number.isInteger(r.stops[0].stop_id));
    stopId = r.stops.find((s) => /Ithaca Commons/.test(s.name))?.stop_id ?? r.stops[0].stop_id;
    const near = await call('tcat_stop_search', { near: '42.4470,-76.4832', limit: 3 });
    ok(near.stops[0].meters_away < 500);
  });
  await test('tcat_departures', async () => {
    const r = await call('tcat_departures', { stop: String(stopId) });
    ok(r.stops.length === 1 && Array.isArray(r.stops[0].departures));
    for (const d of r.stops[0].departures) ok(d.route && /\d{1,2}:\d{2}[ap]m/.test(d.departs) && d.in_minutes >= 0, JSON.stringify(d));
  });
  await test('tcat_alerts', async () => {
    const r = await call('tcat_alerts', {});
    ok(Array.isArray(r.alerts) && r.routes.length > 10);
  });

  // Weather, calendar, places
  await test('weather_ithaca', async () => {
    const r = await call('weather_ithaca', {});
    ok(!r.warnings, JSON.stringify(r.warnings));
    ok(typeof r.now.temperature_f === 'number' && r.now.temperature_f > -40 && r.now.temperature_f < 115, JSON.stringify(r.now));
    ok(r.forecast.length === 6 && Array.isArray(r.alerts));
    const h = await call('weather_ithaca', { hourly: true, periods: 4 });
    eq(h.hourly.length, 4);
  });
  await test('academic_calendar', async () => {
    const r = await call('academic_calendar', {});
    ok(r.events.length > 0 && /^\d{4}-\d{2}-\d{2}/.test(r.events[0].date), JSON.stringify(r).slice(0, 200));
    const b = await call('academic_calendar', { query: 'break' });
    ok(b.total > 0 && b.events.every((e) => /break/i.test(e.title)));
  });
  await test('campus_place_search', async () => {
    const r = await call('campus_place_search', { query: 'Gates Hall' });
    ok(/Gates/.test(r.places[0].name) && Math.abs(r.places[0].lat - 42.445) < 0.01);
    const p = await call('campus_place_search', { category: 'Parking', limit: 5 });
    ok(p.total > 5 && p.places.length === 5);
  });

  // Error paths against the live sources
  await test('live input errors read well', async () => {
    const cases = [
      ['classes_course', { subject: 'CS', number: '9999' }, /not offered/],
      ['events_detail', { id: '123' }, /No event with id/],
      ['library_room_booking_link', { room: 'no such room' }, /No bookable library room/],
      ['cugir_dataset', { id: 'cugir-999999' }, /No CUGIR dataset/],
      ['tcat_departures', { stop: 'no such stop anywhere' }, /No TCAT stop/],
    ];
    for (const [name, args, re] of cases) {
      const j = await rpc('tools/call', { name, arguments: args });
      ok(j.result.isError === true && re.test(j.result.content[0].text), `${name}: ${j.result.content[0].text.slice(0, 160)}`);
      ok(!/Fallback page/.test(j.result.content[0].text), `${name}: an input error should not point to a fallback page`);
    }
  });
}

if (runUnit) await unitTests();
if (runLive) await liveTests();

console.log('\nSummary');
if (runUnit) console.log(`  unit: ${tally.unit[0]} passed, ${tally.unit[1]} failed`);
if (runLive) console.log(`  live: ${tally.live[0]} passed, ${tally.live[1]} failed, ${tally.skipped} skipped`);
for (const f of failures) console.log(`  FAILED ${f}`);
process.exit(failures.length ? 1 : 0);
