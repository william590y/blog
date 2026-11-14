# Cornell Campus MCP server

A remote MCP server with live Cornell and Ithaca data, served by the Cloudflare Pages Function
`functions/mcp.js` at **https://williamliaw.com/mcp**. It uses the Streamable HTTP transport
statelessly (JSON-RPC over POST, no sessions, no auth). Every tool is read-only and uses public,
unauthenticated sources; nothing looks up people or touches an account. It is not an official
Cornell service.

To add it to Claude, go to Settings → Connectors → Add custom connector and enter the URL above.

| Tool | What it answers |
|---|---|
| `dining_open_now` | what's open to eat now or at a time, by area, type or swipes |
| `dining_menus` | every dining hall's menu in one call, by station (meal, area, type, station filters) |
| `dining_eatery` | one eatery's hours and menu (nicknames like Okies, RPME, Appel work) |
| `dining_menu_search` | where a dish is served on a day |
| `dining_list_eateries` | every eatery's hours for a day |
| `gym_occupancy` | live headcount and percent full at each fitness center |
| `gym_schedule` | gym hours and today's group fitness classes |
| `classes_search` | classes in one subject for a term, by keyword, level, instructor or open sections |
| `classes_course` | one course: description, prerequisites, sections, times, instructors, open/closed/waitlist |
| `classes_subjects` | subject codes and names for a term |
| `classes_rosters` | the terms the Class Roster has, the default one and the one in session |
| `library_hours` | library hours for a day, what is open now, service desks, a library's week |
| `events_search` | campus events by date range, keyword, type, department or place |
| `events_detail` | one event in full: description, dates, place, cost, links |
| `events_categories` | the event type, department and theme names used for filtering |
| `cugir_search` | search CUGIR's New York State geospatial datasets |
| `cugir_dataset` | one CUGIR dataset: description, format, extent, downloads, web services |
| `ebird_recent_observations` | recent or notable bird sightings near campus, at a hotspot or in Tompkins County |
| `ebird_hotspots` | birding hotspots near campus with species counts |
| `ebird_species` | look up a species and its recent sightings in the county |
| `tcat_departures` | next buses at a stop, with live estimates |
| `tcat_stop_search` | find bus stops by name or nearest a point |
| `tcat_alerts` | current detours and service alerts, and the route list |
| `weather_ithaca` | current conditions, forecast and weather alerts for Ithaca |
| `academic_calendar` | Registrar dates: breaks, add/drop deadlines, exams, enrollment |
| `campus_place_search` | a building, parking lot or landmark: address, coordinates, directions link |

## Sources

| Group | Source | Cache |
|---|---|---|
| Dining | admin-now.dining.cornell.edu (the Cornell Dining Now feed) | 10 min |
| Gyms | goboardapi.azurewebsites.net (headcounts), scl.cornell.edu (hours, classes) | 1 min, 30 min |
| Classes | classes.cornell.edu/api/2.0 (documented public API; asks for at most 1 request a second) | 10 min; terms and subjects 6 h |
| Library hours | api3.libcal.com, institution 973 (the feed behind the hours on library.cornell.edu) | 15 min |
| Events | events.cornell.edu/api/2 (Localist) | 10 min; filters 12 h |
| CUGIR | cugir.library.cornell.edu `catalog.json` and `/catalog/<id>/raw` (GeoBlacklight) | 1 h |
| eBird | api.ebird.org/v2 (needs a key, below) | 5 min; hotspots and taxonomy 24 h |
| Buses | realtimetcatbus.availtec.com InfoPoint REST (the feed behind TCAT's bus tracker) | departures 30 s; stops 24 h |
| Weather | api.weather.gov (National Weather Service; station KITH, grid BGM/45,71) | 5 to 30 min |
| Academic calendar | registrar.cornell.edu/academic-calendar (HTML, parsed) | 6 h |
| Campus map | www.cornell.edu/about/maps `data.cfm?action=getLocations` | 24 h |

Results are cached in memory per Worker isolate and, for the newer sources, in Cloudflare's Cache
API as well, so repeated questions do not reach the source. Requests carry a generic User-Agent
(`cornell-campus-mcp/0.3`) and nothing about the person asking. The CUGIR and Class Roster sites ask
crawlers (robots.txt) to stay out of their search and API paths; this server is not a crawler: it
makes one cached request when someone asks a question. If a source's owner objects, remove its
tools from `TOOLS` in `functions/mcp.js`.

Not included, on purpose: the library catalog (its robots.txt disallows everything and it answers
Cloudflare's network with a challenge page, not JSON) and eCommons (its firewall rate-limits after
two requests).

Instructor NetIDs in the Class Roster feed are dropped (names only), and eBird sightings at
personal locations are reported without the location's name.

## eBird key

The eBird tools need an API key. It is read from the environment variable `EBIRD_API_KEY` of the
Cloudflare Pages project and sent to eBird in a request header. It must never be committed to this
repository. Without it the three eBird tools answer "eBird is not configured".

1. Request a key at https://ebird.org/api/keygen (a free eBird account; eBird's API terms of use
   apply to whoever holds the key).
2. In the Cloudflare dashboard: Workers & Pages → the Pages project that serves williamliaw.com
   (its preview domain is `blog-eoa.pages.dev`) → Settings → Variables
   and Secrets → Add. Type "Secret", name `EBIRD_API_KEY`, value the key. Add it for the
   **Production** environment and again for **Preview**.
3. Redeploy (Deployments → the latest production deployment → Retry deployment, or push any
   commit): variables apply to deployments made after they are set.
4. Check: `cornell_mcp/test/e2e.sh` should no longer report "eBird not configured".

## Tests

```bash
node cornell_mcp/test/run.mjs          # unit tests on recorded fixtures, then every tool against the live sources
node cornell_mcp/test/run.mjs --unit   # fixtures only, no network
EBIRD_API_KEY=... node cornell_mcp/test/run.mjs --live   # include live eBird calls
cornell_mcp/test/e2e.sh https://williamliaw.com/mcp      # a deployed server, with curl
```

Node 18 or later, no dependencies. The fixtures in `test/fixtures/` are trimmed recordings of the
real responses, except the eBird observations and hotspots, which follow eBird's documented
response format because no key was available to record with.

## Layout

`functions/mcp.js` holds the protocol handling, the tool list and the instructions text sent to
the model. `lib/` holds one module per source. `lib/dining.mjs`, `lib/gym.mjs` and `lib/util.mjs`
are the cornell-campus skill's data code ported to Workers: no `node:child_process`, no
`process.env` (secrets come from `context.env`).
