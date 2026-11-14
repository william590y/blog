// Cornell campus MCP server: live Cornell Dining hours and menus, gym crowding and hours, the Class
// Roster, library hours and catalog, the events calendar, CUGIR geodata, eBird sightings, TCAT buses,
// Ithaca weather, the academic calendar and the campus map. A Cloudflare Pages Function
// served at https://williamliaw.com/mcp, speaking MCP's Streamable HTTP transport statelessly: every
// POST carries JSON-RPC and gets a JSON reply, with no sessions and no SSE stream. Add it in Claude
// under Settings -> Connectors -> Add custom connector, URL https://williamliaw.com/mcp, no
// authentication. Every tool is read-only.
//
// The data code is in /cornell_mcp/lib (dining and gym are the cornell-campus skill's, ported to
// Workers). The only secret is the optional eBird key, read from the EBIRD_API_KEY environment
// variable of the Pages project.

import {
  diningEatery,
  diningListEateries,
  diningMenuSearch,
  diningMenus,
  diningOpenNow,
} from '../cornell_mcp/lib/dining.mjs';
import { gymOccupancy, gymSchedule } from '../cornell_mcp/lib/gym.mjs';
import { classesCourse, classesRosters, classesSearch, classesSubjects } from '../cornell_mcp/lib/classes.mjs';
import { libraryCatalogItem, libraryCatalogSearch, libraryHours } from '../cornell_mcp/lib/library.mjs';
import { eventsCategories, eventsDetail, eventsSearch } from '../cornell_mcp/lib/events.mjs';
import { cugirDataset, cugirSearch } from '../cornell_mcp/lib/cugir.mjs';
import { ebirdHotspots, ebirdRecentObservations, ebirdSpecies } from '../cornell_mcp/lib/ebird.mjs';
import { tcatAlerts, tcatDepartures, tcatStopSearch } from '../cornell_mcp/lib/tcat.mjs';
import { weatherIthaca } from '../cornell_mcp/lib/weather.mjs';
import { academicCalendar } from '../cornell_mcp/lib/calendar.mjs';
import { campusPlaceSearch } from '../cornell_mcp/lib/places.mjs';
import { InputError } from '../cornell_mcp/lib/util.mjs';

const SERVER_INFO = { name: 'cornell-campus', title: 'Cornell Campus', version: '0.3.0' };
const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

const INSTRUCTIONS = `Live Cornell University and Ithaca data: dining, gyms, classes, libraries, events, buses, weather, the academic calendar, campus places, birds (eBird) and geodata (CUGIR). Always call a tool instead of answering from memory: hours, menus, crowd levels, class offerings and schedules change by semester, break and day.
- All times are Ithaca local time. Dates accept today, tomorrow, a weekday name or YYYY-MM-DD; times accept 7pm or 19:00. Areas: North, West, Central.
- "Dining hall" means type "dining room" (all-you-care-to-eat, takes meal swipes). Cafes, coffee shops and markets mostly take BRBs/Cornell Card; check accepts_swipes.
- Nicknames work: Okies (Okenshields), RPME (Robert Purcell), Appel (North Star), Morrison, Becker/Cook/Rose/Keeton/Bethe (West Campus houses), 104West (kosher/multicultural).
- If nothing is open, lead with what opens next (opening_soon). If a result notes unpublished dates, say hours or menus are not out yet.
- Gym level: quiet < 25% <= moderate < 50% <= busy < 75% <= very busy. Give the headcount and percent, not only the label. If minutes_since_update > 20 while open, say the count may be stale. "closed" means closed: report the next opening. Gym hours are regular-semester hours; breaks may differ.
- Menus: for "what's for dinner" or "what's on the menu", call dining_menus once (every dining hall, by station); dining_eatery for one place; dining_menu_search only to find where a specific dish is.
- Summarize menus (main entrees, stations, notable vegetarian items) unless the full menu is asked for. Lead with the answer and keep it short.
- Classes: the Class Roster searches one subject at a time, so a subject is required (classes_subjects finds the code). roster defaults to the one Cornell's site shows by default, usually the next term once it is published; pass "current" for the term in session, or a code such as FA26. classes_search to browse or filter; classes_course for one course's sections, times, instructors and open/closed/waitlist status. There are no seat counts or rooms in the feed.
- Libraries: library_hours for hours and what is open now (Olin, Uris, Mann and the unit libraries, with service desks); library_catalog_search then library_catalog_item for holdings, call numbers and availability. No account features: requests and renewals happen on the catalog page.
- Events: events_search by dates, keyword, type, department or place; events_detail for one event; events_categories lists the type and department names.
- Buses: tcat_departures takes a stop name or id and gives the next buses with live estimates; tcat_stop_search finds stops (near "lat,lng" from campus_place_search if needed); tcat_alerts for detours.
- Dates such as breaks, add/drop deadlines, exams and enrollment: academic_calendar. Weather: weather_ithaca. Where a building or parking lot is: campus_place_search.
- Birds: ebird_recent_observations (set notable for rarities), ebird_hotspots, ebird_species. These need an eBird key on the server; if a tool says eBird is not configured, say so plainly and give the eBird link it returns.
- GIS data for New York State: cugir_search then cugir_dataset (downloads, formats, extent).
- If a tool reports a source error, say so and point to the fallback page it names (dining: https://now.dining.cornell.edu, gyms: https://scl.cornell.edu/recreation/cornell-fitness-centers).`;

const DATE = { type: 'string', description: 'today, tomorrow, a weekday name, or YYYY-MM-DD (default today)' };
const AREA = { type: 'string', description: 'Campus area: North, West or Central' };
const TYPE = {
  type: 'string',
  description: 'Eatery type, e.g. "dining hall" (all-you-care-to-eat), "cafe", "coffee shop", "market"',
};
const MEAL = { type: 'string', description: 'Breakfast, Brunch, Lunch, Dinner or Late Night' };
const SWIPES = { type: 'boolean', description: 'Only eateries that take meal swipes' };
const ROSTER = {
  type: 'string',
  description: 'Term: a roster code (FA26, SP27), "fall 2026", or "current" for the term in session (default: the Class Roster\'s default term)',
};
/** A closed object schema for the newer tools. */
const obj = (properties, required) => ({ type: 'object', properties, ...(required ? { required } : {}), additionalProperties: false });
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

const TOOLS = [
  {
    name: 'dining_open_now',
    title: 'What is open to eat',
    description:
      'Cornell eateries open now (or at a given time/date), with closing times, plus places opening soon. Use for "what\'s open for dinner on North", "where can I use a swipe now".',
    inputSchema: {
      type: 'object',
      properties: {
        time: { type: 'string', description: 'Time of day, e.g. 9pm or 21:00 (default now)' },
        date: DATE,
        area: AREA,
        type: TYPE,
        accepts_swipes: SWIPES,
        opening_within_minutes: {
          type: 'number',
          description: 'Also list places opening within this many minutes (default 60)',
        },
      },
    },
    run: (a) => diningOpenNow(a),
  },
  {
    name: 'dining_menus',
    title: "Every dining hall's menu",
    description:
      'Full menus at ALL Cornell dining halls in one call, grouped by station (Grill, Pizza, Vegan/Vegetarian, Dessert...). Use for "what\'s for dinner tonight", "what are the dining halls serving", "best lunch on West". Defaults: dining halls only; today = the meal each hall is serving now or next; another day = all meals. Set meal to pick one, or "all".',
    inputSchema: {
      type: 'object',
      properties: {
        date: DATE,
        meal: {
          type: 'string',
          description: 'Breakfast, Brunch, Lunch, Dinner, Late Night, or "all" (default: serving now or next today)',
        },
        area: AREA,
        type: {
          type: 'string',
          description: 'Default "dining hall"; "cafe", "market", etc., or "all" for every eatery',
        },
        accepts_swipes: SWIPES,
        station: { type: 'string', description: 'Only stations matching this, e.g. "grill", "vegan", "dessert"' },
      },
    },
    run: (a) => diningMenus(a),
  },
  {
    name: 'dining_eatery',
    title: 'One eatery: hours and menu',
    description:
      "One Cornell eatery's hours and full menu for a day, e.g. Okies dinner tonight. Accepts nicknames (Okies, RPME, Appel). For every dining hall at once, use dining_menus.",
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Eatery name or nickname, e.g. "Okies", "Morrison", "Becker"' },
        date: DATE,
        meal: MEAL,
        include_menu: { type: 'boolean', description: 'Include the menu (default true); false for hours only' },
      },
      required: ['name'],
    },
    run: (a) => diningEatery(a),
  },
  {
    name: 'dining_menu_search',
    title: 'Where is a dish served',
    description:
      'Find which Cornell eateries serve one specific dish or ingredient on a day, e.g. "where\'s ramen today". Returns only matching items; to see whole menus use dining_menus.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Dish or ingredient, e.g. "ramen", "tacos", "vegan"' },
        date: DATE,
        meal: MEAL,
        area: AREA,
        type: TYPE,
        limit: { type: 'integer', description: 'Max results, 1-100 (default 25)' },
      },
      required: ['query'],
    },
    run: (a) => diningMenuSearch(a),
  },
  {
    name: 'dining_list_eateries',
    title: 'All eateries for a day',
    description: "Every Cornell eatery with that day's hours, optionally filtered by area, type or swipes.",
    inputSchema: {
      type: 'object',
      properties: { date: DATE, area: AREA, type: TYPE, accepts_swipes: SWIPES },
    },
    run: (a) => diningListEateries(a),
  },
  {
    name: 'gym_occupancy',
    title: 'How crowded are the gyms',
    description:
      'Live headcount and percent full at Cornell fitness centers (Helen Newman, Toni Morrison, Noyes, Teagle Upstairs/Downstairs). Use for "is Teagle busy", "which gym is emptiest".',
    inputSchema: {
      type: 'object',
      properties: {
        facility: { type: 'string', description: 'One gym, e.g. "teagle", "noyes" (default all)' },
        include_courts: { type: 'boolean', description: 'Also include courts and pools' },
      },
    },
    run: (a) => gymOccupancy(a),
  },
  {
    name: 'gym_schedule',
    title: 'Gym hours and classes',
    description: "Cornell fitness centers' posted hours, whether each is open, and today's group fitness classes.",
    inputSchema: {
      type: 'object',
      properties: { facility: { type: 'string', description: 'One gym, e.g. "noyes" (default all)' } },
    },
    run: (a) => gymSchedule(a),
  },
  // ---- Class Roster ----
  {
    name: 'classes_search',
    title: 'Search classes in a subject',
    description:
      'Search Cornell\'s Class Roster within one subject for a term: by keyword, course level, instructor or open sections. Returns each course\'s title, credits, instructors, meeting times and section status. Use for "what CS classes are offered next semester", "4000-level music courses", "who teaches MATH 2210". A subject is required (the roster searches one subject at a time).',
    inputSchema: obj(
      {
        subject: { type: 'string', description: 'Subject code or name, e.g. "CS", "MATH", "Music"' },
        query: { type: 'string', description: 'Keyword in the title or description, e.g. "machine learning"' },
        roster: ROSTER,
        level: { type: 'integer', description: 'Course level: 1000, 2000 ... 9000', minimum: 1000, maximum: 9999 },
        instructor: { type: 'string', description: 'Only classes taught by an instructor whose name contains this' },
        open_only: { type: 'boolean', description: 'Only classes with at least one open section' },
        limit: { type: 'integer', description: 'Max classes, 1-50 (default 20)', minimum: 1, maximum: 50 },
        offset: { type: 'integer', description: 'Skip this many results (for paging)', minimum: 0 },
      },
      ['subject'],
    ),
    run: (a) => classesSearch(a),
  },
  {
    name: 'classes_course',
    title: 'One course: sections and times',
    description:
      'Full Class Roster entry for one course in a term, e.g. CS 4780: description, prerequisites, credits, grading, and every section with days, times, dates, instructors, instruction mode and open/closed/waitlist status. Use for "when does CS 2110 meet", "is PHYS 1112 open", "prereqs for MATH 4130".',
    inputSchema: obj(
      {
        subject: { type: 'string', description: 'Subject code, e.g. "CS" (or the whole course, "CS 4780")' },
        number: { type: 'string', description: 'Four-digit catalog number, e.g. "4780"', pattern: '^\\d{4}$' },
        roster: ROSTER,
      },
      ['subject'],
    ),
    run: (a) => classesCourse(a),
  },
  {
    name: 'classes_subjects',
    title: 'Subject codes',
    description: 'Class Roster subject codes and names for a term (e.g. CS: Computer Science), optionally filtered by a word. Use to find the subject code before classes_search.',
    inputSchema: obj({
      query: { type: 'string', description: 'Filter by part of a name or code, e.g. "bio", "asian"' },
      roster: ROSTER,
    }),
    run: (a) => classesSubjects(a),
  },
  {
    name: 'classes_rosters',
    title: 'Available terms',
    description: 'The terms (rosters) the Class Roster has, newest first, with the default one and the term in session now.',
    inputSchema: obj({ all: { type: 'boolean', description: 'List every roster (default: the nine most recent)' } }),
    run: (a) => classesRosters(a),
  },
  // ---- Library ----
  {
    name: 'library_hours',
    title: 'Library hours and what is open',
    description:
      'Cornell University Library hours for a day and whether each library is open now (Olin, Uris, Mann, Law, Fine Arts, Music, Math, etc.). Naming one library also gives its service desks and the next six days. Use for "is Olin open", "which libraries are open late tonight", "Mann hours on Sunday".',
    inputSchema: obj({
      library: { type: 'string', description: 'One library or service, e.g. "Olin", "Mann", "Uris", "Law", "Libe Cafe" (default all libraries)' },
      date: DATE,
      open_only: { type: 'boolean', description: 'Only libraries open right now (today only)' },
      include_services: { type: 'boolean', description: 'Also list service desks and spaces under each library' },
    }),
    run: (a) => libraryHours(a),
  },
  {
    name: 'library_catalog_search',
    title: 'Search the library catalog',
    description:
      'Search the Cornell University Library catalog (books, journals, scores, recordings, videos, maps, theses, e-resources). Returns title, author, format, call number locations and whether a copy is available or online. Use for "does the library have Gravity\'s Rainbow", "books by Hannah Arendt".',
    inputSchema: obj(
      {
        query: { type: 'string', description: 'Title, author, topic, ISBN or call number' },
        field: { type: 'string', description: 'Where to search (default all)', enum: ['all', 'title', 'author', 'subject', 'call number', 'isbn', 'publisher', 'series'] },
        format: { type: 'string', description: 'e.g. "Book", "Journal/Periodical", "Musical Score", "Video", "Map", "Thesis"' },
        online_only: { type: 'boolean', description: 'Only items available online' },
        limit: { type: 'integer', description: 'Max results, 1-25 (default 10)', minimum: 1, maximum: 25 },
        page: { type: 'integer', description: 'Results page (default 1)', minimum: 1 },
      },
      ['query'],
    ),
    run: (a) => libraryCatalogSearch(a),
  },
  {
    name: 'library_catalog_item',
    title: 'One catalog record: holdings',
    description: 'One library catalog record by id (from library_catalog_search): every holding with library, call number, item status and due date, plus subjects, summary and online links.',
    inputSchema: obj({ id: { type: 'string', description: 'Catalog record id, e.g. "857387"', pattern: '^\\d{1,12}$' } }, ['id']),
    run: (a) => libraryCatalogItem(a),
  },
  // ---- Events ----
  {
    name: 'events_search',
    title: 'Cornell events',
    description:
      'Upcoming events on the Cornell events calendar by date range, keyword, event type, department or place: lectures, concerts, athletics, exhibits, workshops. Defaults to the next 7 days. Use for "what\'s happening this weekend", "concerts in December", "CS colloquium this week", "events at Bailey Hall".',
    inputSchema: obj({
      query: { type: 'string', description: 'Keyword, e.g. "concert", "career fair"' },
      start: { type: 'string', description: 'First day: today, tomorrow, a weekday name, or YYYY-MM-DD (default today)' },
      end: { type: 'string', description: 'Last day, inclusive (same forms as start); overrides days' },
      days: { type: 'integer', description: 'Number of days from start (default 7)', minimum: 1, maximum: 370 },
      type: { type: 'string', description: 'Event type name, e.g. "Lecture", "Concert", "Athletic" (see events_categories)' },
      department: { type: 'string', description: 'Department or unit name, e.g. "Athletics", "Cornell Cinema" (see events_categories)' },
      place: { type: 'string', description: 'Building or venue name, e.g. "Bailey Hall", "Johnson Museum"' },
      limit: { type: 'integer', description: 'Max events, 1-50 (default 15)', minimum: 1, maximum: 50 },
      page: { type: 'integer', description: 'Results page (default 1)', minimum: 1 },
    }),
    run: (a) => eventsSearch(a),
  },
  {
    name: 'events_detail',
    title: 'One event in full',
    description: 'One Cornell event by id (from events_search): full description, all upcoming dates, location, cost, ticket and stream links.',
    inputSchema: obj({ id: { type: 'string', description: 'Event id from events_search', pattern: '^\\d+$' } }, ['id']),
    run: (a) => eventsDetail(a),
  },
  {
    name: 'events_categories',
    title: 'Event types and departments',
    description: 'Names of the event types, departments or themes used on the Cornell events calendar, for the type / department filters of events_search.',
    inputSchema: obj({
      kind: { type: 'string', description: 'Which list (default type)', enum: ['type', 'department', 'theme'] },
      query: { type: 'string', description: 'Filter names by a word, e.g. "music"' },
    }),
    run: (a) => eventsCategories(a),
  },
  // ---- CUGIR ----
  {
    name: 'cugir_search',
    title: 'Search CUGIR geodata',
    description:
      'Search CUGIR, the Cornell University Geospatial Information Repository: GIS datasets for New York State (roads, parcels, hydrography, elevation, soils, land cover, boundaries, aerial imagery). Use for "GIS data for Tompkins County roads", "New York wetlands shapefile".',
    inputSchema: obj({
      query: { type: 'string', description: 'Place and/or theme, e.g. "Tompkins roads", "Cayuga Lake bathymetry" (empty lists everything)' },
      limit: { type: 'integer', description: 'Max datasets, 1-30 (default 10)', minimum: 1, maximum: 30 },
      page: { type: 'integer', description: 'Results page (default 1)', minimum: 1 },
    }),
    run: (a) => cugirSearch(a),
  },
  {
    name: 'cugir_dataset',
    title: 'One CUGIR dataset',
    description: 'One CUGIR dataset by id (from cugir_search): description, creators, dates, format, file size, bounding box, download links, metadata and WMS/WFS services.',
    inputSchema: obj({ id: { type: 'string', description: 'Dataset id, e.g. "cugir-007879"' } }, ['id']),
    run: (a) => cugirDataset(a),
  },
  // ---- eBird ----
  {
    name: 'ebird_recent_observations',
    title: 'Recent bird sightings',
    description:
      'Recent eBird sightings near Cornell: the latest report of each species around campus, at a named Ithaca-area hotspot (Sapsucker Woods, Stewart Park, Beebe Lake...) or in Tompkins County; set notable for rare or unseasonal birds, or species for one bird. Use for "what birds are around campus", "any rarities near Ithaca", "has anyone seen a snowy owl". Needs an eBird key on the server.',
    inputSchema: obj({
      location: { type: 'string', description: '"campus" (default), "Tompkins County", a hotspot name near Ithaca, a hotspot id (L...), a region code, or "lat,lng"' },
      notable: { type: 'boolean', description: 'Only notable (rare, unseasonal) sightings' },
      species: { type: 'string', description: 'Only this species: common name or eBird code, e.g. "cedar waxwing"' },
      days_back: { type: 'integer', description: 'Days to look back, 1-30 (default 3)', minimum: 1, maximum: 30 },
      radius_km: { type: 'integer', description: 'Search radius for campus or lat,lng, 1-50 km (default 5)', minimum: 1, maximum: 50 },
      limit: { type: 'integer', description: 'Max rows, 1-100 (default 30)', minimum: 1, maximum: 100 },
    }),
    run: (a, env) => ebirdRecentObservations(a, env),
  },
  {
    name: 'ebird_hotspots',
    title: 'Birding hotspots near Ithaca',
    description: 'eBird hotspots near Cornell (or a lat,lng) with distance, all-time species count and latest checklist. Use for "where to go birding near campus". Needs an eBird key on the server.',
    inputSchema: obj({
      near: { type: 'string', description: '"campus" (default) or "lat,lng"' },
      radius_km: { type: 'integer', description: 'Radius, 1-50 km (default 10)', minimum: 1, maximum: 50 },
      query: { type: 'string', description: 'Filter by part of a hotspot name' },
      sort: { type: 'string', description: 'Order (default species count)', enum: ['species', 'distance'] },
      limit: { type: 'integer', description: 'Max hotspots, 1-60 (default 20)', minimum: 1, maximum: 60 },
    }),
    run: (a, env) => ebirdHotspots(a, env),
  },
  {
    name: 'ebird_species',
    title: 'Look up a bird species',
    description: 'Look up a bird by common name, scientific name or eBird code among species recorded in Tompkins County: its eBird code, family, and its recent sightings in the county. Needs an eBird key on the server.',
    inputSchema: obj(
      {
        name: { type: 'string', description: 'e.g. "pileated woodpecker", "Bombycilla cedrorum", "cedwax"' },
        include_recent: { type: 'boolean', description: 'Include recent county sightings of the best match (default true)' },
        days_back: { type: 'integer', description: 'Days to look back for sightings, 1-30 (default 14)', minimum: 1, maximum: 30 },
      },
      ['name'],
    ),
    run: (a, env) => ebirdSpecies(a, env),
  },
  // ---- TCAT buses ----
  {
    name: 'tcat_departures',
    title: 'Next buses at a stop',
    description:
      'Next TCAT bus departures at a stop, with live estimates and lateness. Takes a stop id or part of a stop name; a name that matches a pair of stops returns both directions. Use for "when is the next 30 from Sage Hall", "buses from the Commons".',
    inputSchema: obj(
      {
        stop: { type: 'string', description: 'Stop id from tcat_stop_search, or part of a stop name, e.g. "Sage Hall", "Commons"' },
        route: { type: 'string', description: 'Only this route, e.g. "30", "81"' },
        limit: { type: 'integer', description: 'Max departures per stop, 1-25 (default 8)', minimum: 1, maximum: 25 },
      },
      ['stop'],
    ),
    run: (a) => tcatDepartures(a),
  },
  {
    name: 'tcat_stop_search',
    title: 'Find bus stops',
    description: 'Find TCAT bus stops by name, or the stops nearest a point (lat,lng, e.g. from campus_place_search). Returns stop ids for tcat_departures.',
    inputSchema: obj({
      query: { type: 'string', description: 'Part of a stop name, e.g. "Collegetown", "Risley"' },
      near: { type: 'string', description: 'A point as "lat,lng" to sort stops by distance', pattern: '^\\s*-?\\d{1,2}(\\.\\d+)?\\s*,\\s*-?\\d{1,3}(\\.\\d+)?\\s*$' },
      limit: { type: 'integer', description: 'Max stops, 1-25 (default 10)', minimum: 1, maximum: 25 },
    }),
    run: (a) => tcatStopSearch(a),
  },
  {
    name: 'tcat_alerts',
    title: 'Bus detours and alerts',
    description: 'Current TCAT service alerts (detours, stop closures, cancellations) and the list of routes.',
    inputSchema: obj({ route: { type: 'string', description: 'Only alerts for this route, e.g. "92"' } }),
    run: (a) => tcatAlerts(a),
  },
  // ---- Weather, calendar, map ----
  {
    name: 'weather_ithaca',
    title: 'Ithaca weather',
    description: 'Current conditions, National Weather Service forecast and active weather alerts for Ithaca and the Cornell campus. Use for "do I need a coat", "will it snow tomorrow", "is there a winter storm warning".',
    inputSchema: obj({
      hourly: { type: 'boolean', description: 'Hour-by-hour forecast instead of day and night periods' },
      periods: { type: 'integer', description: 'How many periods (default 6 half-days, or 12 hours when hourly)', minimum: 1, maximum: 48 },
    }),
    run: (a) => weatherIthaca(a),
  },
  {
    name: 'academic_calendar',
    title: 'Academic calendar dates',
    description:
      'Key dates from the Cornell Registrar\'s academic calendar: first and last day of classes, breaks, add/drop and grading-basis deadlines, study days, exams, enrollment windows, commencement. Defaults to what is coming up; a query searches the whole published year. Use for "when is spring break", "last day to drop", "when do finals start".',
    inputSchema: obj({
      query: { type: 'string', description: 'Words in the entry, e.g. "spring break", "drop", "exams", "enrollment"' },
      from: { type: 'string', description: 'Earliest date: today, tomorrow, a weekday name, or YYYY-MM-DD' },
      to: { type: 'string', description: 'Latest date (same forms)' },
      limit: { type: 'integer', description: 'Max entries, 1-80 (default 15, or 25 with a query)', minimum: 1, maximum: 80 },
    }),
    run: (a) => academicCalendar(a),
  },
  {
    name: 'campus_place_search',
    title: 'Find a campus building or lot',
    description: 'Find a building, parking lot or landmark on the Cornell campus map by name or nickname: address, coordinates and a walking-directions link. Use for "where is Gates Hall", "address of Barton Hall", "parking lots on campus" (category "Parking"). It has locations only, not parking availability or rooms.',
    inputSchema: obj({
      query: { type: 'string', description: 'Building or place name, e.g. "Duffield", "Statler"' },
      category: { type: 'string', description: 'A map category, e.g. "Parking", "Athletics", "North Campus"' },
      limit: { type: 'integer', description: 'Max places, 1-60 (default 6 with a query)', minimum: 1, maximum: 60 },
    }),
    run: (a) => campusPlaceSearch(a),
  },
];
const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, GET, OPTIONS',
  'access-control-allow-headers': 'content-type, accept, authorization, mcp-protocol-version, mcp-session-id',
  'access-control-expose-headers': 'mcp-session-id',
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS },
  });

const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

// Where to send someone when a source is down, by tool-name prefix.
const DINING_GYM_FALLBACK =
  'Fallback pages: https://now.dining.cornell.edu (dining), https://scl.cornell.edu/recreation/cornell-fitness-centers (gyms)';
const FALLBACKS = {
  dining: DINING_GYM_FALLBACK,
  gym: DINING_GYM_FALLBACK,
  classes: 'Fallback page: https://classes.cornell.edu',
  library_hours: 'Fallback page: https://www.library.cornell.edu/libraries/',
  library_catalog: 'Fallback page: https://catalog.library.cornell.edu',
  events: 'Fallback page: https://events.cornell.edu',
  cugir: 'Fallback page: https://cugir.library.cornell.edu',
  ebird: 'Fallback page: https://ebird.org/region/US-NY-109',
  tcat: 'Fallback page: https://tcatbus.com',
  weather: 'Fallback page: https://forecast.weather.gov/MapClick.php?lat=42.4534&lon=-76.4735',
  academic: 'Fallback page: https://registrar.cornell.edu/academic-calendar',
  campus: 'Fallback page: https://www.cornell.edu/about/maps/',
};
const fallbackFor = (name) =>
  FALLBACKS[Object.keys(FALLBACKS).sort((a, b) => b.length - a.length).find((k) => name.startsWith(k))] || '';

async function callTool(params, env) {
  const tool = TOOL_BY_NAME.get(params?.name);
  if (!tool) return { error: { code: -32602, message: `Unknown tool: ${params?.name}` } };
  const args = params.arguments && typeof params.arguments === 'object' && !Array.isArray(params.arguments) ? params.arguments : {};
  try {
    const result = await tool.run(args, env || {});
    return { result: { content: [{ type: 'text', text: JSON.stringify(result) }], isError: false } };
  } catch (err) {
    const text = err instanceof InputError ? err.message : `${err.message}. ${fallbackFor(tool.name)}`;
    return { result: { content: [{ type: 'text', text }], isError: true } };
  }
}

async function handle(msg, env) {
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return rpcError(msg?.id, -32600, 'Invalid Request');
  }
  const isNotification = msg.id === undefined || msg.id === null;
  if (isNotification) return null;
  const { id, method, params } = msg;
  switch (method) {
    case 'initialize': {
      const asked = params?.protocolVersion;
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: INSTRUCTIONS,
        },
      };
    }
    case 'ping':
      return { jsonrpc: '2.0', id, result: {} };
    case 'tools/list':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          tools: TOOLS.map(({ name, title, description, inputSchema }) => ({
            name,
            title,
            description,
            inputSchema,
            annotations: { title, ...READ_ONLY },
          })),
        },
      };
    case 'tools/call': {
      const r = await callTool(params, env);
      return r.error ? rpcError(id, r.error.code, r.error.message) : { jsonrpc: '2.0', id, result: r.result };
    }
    case 'resources/list':
      return { jsonrpc: '2.0', id, result: { resources: [] } };
    case 'prompts/list':
      return { jsonrpc: '2.0', id, result: { prompts: [] } };
    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'POST') {
    // Stateless server: no SSE stream to open (GET) and no session to end (DELETE).
    return new Response('Cornell Campus MCP server. POST JSON-RPC to this URL.\n', {
      status: 405,
      headers: { allow: 'POST, OPTIONS', 'content-type': 'text/plain', ...CORS },
    });
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return json(rpcError(null, -32700, 'Parse error'), 400);
  }
  if (Array.isArray(body)) {
    const replies = (await Promise.all(body.map((m) => handle(m, env)))).filter(Boolean);
    return replies.length ? json(replies) : new Response(null, { status: 202, headers: CORS });
  }
  const reply = await handle(body, env);
  return reply ? json(reply) : new Response(null, { status: 202, headers: CORS });
}
