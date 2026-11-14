#!/usr/bin/env bash
# End-to-end check of a deployed Cornell campus MCP server with curl: initialize, tools/list and
# one call per tool. Usage: cornell_mcp/test/e2e.sh [url]   (default https://williamliaw.com/mcp)
# The eBird tools pass either way: with a key on the server they must return data, without one
# they must say eBird is not configured (reported as "not configured").
set -u
URL="${1:-https://williamliaw.com/mcp}"
PASS=0; FAIL=0; NOTCONF=0

post() { curl -sS -m 60 -X POST "$URL" -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d "$1"; }
# check <label> <json reply> <node expression over j (the parsed reply) returning true | 'notconf' | false/string>
check() {
  local out
  out=$(printf '%s' "$2" | node -e '
    let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
      let j; try { j = JSON.parse(s); } catch { console.log("FAIL not JSON: " + s.slice(0, 160)); return; }
      const t = j.result?.content?.[0]?.text ?? "";
      let r; try { r = (0, eval)("(j, t) => (" + process.argv[1] + ")")(j, t); } catch (e) { r = "threw " + e.message; }
      if (r === true) console.log("ok " + (t ? t.length + " chars" : ""));
      else if (r === "notconf") console.log("notconf");
      else console.log("FAIL " + (typeof r === "string" ? r : "") + " " + (t || s).slice(0, 220));
    });' "$3")
  case "$out" in
    ok*) PASS=$((PASS + 1)); echo "  ok    $1 ($out)" ;;
    notconf) PASS=$((PASS + 1)); NOTCONF=$((NOTCONF + 1)); echo "  ok    $1 (eBird not configured on this server)" ;;
    *) FAIL=$((FAIL + 1)); echo "  FAIL  $1: $out" ;;
  esac
}
call() { # call <tool> <json args> <expression over d (parsed result), t (text)>
  local reply
  reply=$(post "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"$1\",\"arguments\":$2}}")
  check "$1" "$reply" "j.result && j.result.isError === false && t.length < 40000 && ((d) => ($3))(JSON.parse(t))"
}
ebird() {
  local reply
  reply=$(post "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"$1\",\"arguments\":$2}}")
  check "$1" "$reply" "j.result.isError ? (/eBird is not configured/.test(t) ? 'notconf' : false) : ((d) => ($3))(JSON.parse(t))"
}

echo "Server: $URL"
check initialize "$(post '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"e2e","version":"1"}}}')" \
  "j.result.serverInfo.version === '0.3.0' && j.result.protocolVersion === '2025-06-18' && /classes_search/.test(j.result.instructions)"
check tools/list "$(post '{"jsonrpc":"2.0","id":2,"method":"tools/list"}')" \
  "j.result.tools.length === 26 && ['dining_menus','gym_occupancy','classes_course','library_hours','events_search','cugir_dataset','ebird_recent_observations','tcat_departures','weather_ithaca','academic_calendar','campus_place_search'].every((n) => j.result.tools.some((x) => x.name === n))"
STATUS=$(curl -sS -m 30 -o /dev/null -w '%{http_code}' "$URL")
if [ "$STATUS" = 405 ]; then PASS=$((PASS + 1)); echo "  ok    GET answers 405"; else FAIL=$((FAIL + 1)); echo "  FAIL  GET answered $STATUS"; fi

call dining_open_now '{}' "typeof d.open_count === 'number'"
call dining_menus '{"date":"tomorrow","meal":"Dinner"}' "typeof d === 'object' && !d.error"
call dining_eatery '{"name":"Okies","include_menu":false}' "/Okenshields/i.test(t)"
call dining_menu_search '{"query":"chicken","date":"tomorrow"}' "typeof d === 'object'"
call dining_list_eateries '{"area":"North"}' "t.length > 200"
call gym_occupancy '{}' "d.facilities.length >= 4"
call gym_schedule '{}' "d.facilities.length >= 4 && !d.warnings"
call classes_rosters '{}' "d.rosters.length >= 5 && !!d.default_roster"
sleep 1
call classes_subjects '{"query":"computer science","roster":"current"}' "d.subjects.some((s) => s.startsWith('CS:'))"
sleep 1
call classes_search '{"subject":"CS","roster":"current","level":2000,"limit":5}' "d.total > 0 && /^CS \\d{4}\$/.test(d.classes[0].course)"
sleep 1
call classes_course '{"subject":"CS","number":"2110","roster":"current"}' "d.sections.length > 0 && d.course === 'CS 2110'"
call library_hours '{"library":"Olin"}' "d.libraries[0].name === 'Olin Library' && typeof d.libraries[0].hours === 'string'"
call events_search '{"days":14,"limit":5}' "d.total > 0 && !!d.events[0].title"
EVENT_ID=$(post '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"events_search","arguments":{"days":14,"limit":1}}}' | node -e 'let s="";process.stdin.on("data",(d)=>(s+=d)).on("end",()=>{try{console.log(JSON.parse(JSON.parse(s).result.content[0].text).events[0].id)}catch{console.log("0")}})')
call events_detail "{\"id\":\"$EVENT_ID\"}" "!!d.title && !!d.url"
call events_categories '{"kind":"type"}' "d.names.includes('Lecture')"
call cugir_search '{"query":"Tompkins County roads","limit":3}' "d.total > 0 && /^cugir-/.test(d.datasets[0].id)"
call cugir_dataset '{"id":"cugir-007879"}' "d.format === 'Shapefile' && d.downloads.length > 0"
ebird ebird_recent_observations '{"days_back":7}' "Array.isArray(d.observations)"
ebird ebird_hotspots '{}' "d.hotspots.length > 0"
ebird ebird_species '{"name":"northern cardinal"}' "d.matches[0].code === 'norcar'"
call tcat_stop_search '{"query":"Commons"}' "d.count > 0"
call tcat_departures '{"stop":"Ithaca Commons - Seneca St"}' "d.stops.length >= 1 && Array.isArray(d.stops[0].departures)"
call tcat_alerts '{}' "Array.isArray(d.alerts) && d.routes.length > 10"
call weather_ithaca '{}' "typeof d.now.temperature_f === 'number' && d.forecast.length === 6 && !d.warnings"
call academic_calendar '{"query":"break"}' "d.total > 0"
call campus_place_search '{"query":"Gates Hall"}' "/Gates/.test(d.places[0].name)"

echo "Result: $PASS passed, $FAIL failed ($NOTCONF eBird tools answered \"not configured\")"
[ "$FAIL" = 0 ]
