# Cornell Campus MCP server

A remote MCP server with live Cornell Dining and fitness-center data, served by the Cloudflare Pages
Function `functions/mcp.js` at **https://williamliaw.com/mcp**. It uses the Streamable HTTP transport
statelessly (JSON-RPC over POST, no sessions, no auth).

| Tool | What it answers |
|---|---|
| `dining_open_now` | what's open to eat now or at a time, by area, type or swipes |
| `dining_eatery` | one eatery's hours and menu (nicknames like Okies, RPME, Appel work) |
| `dining_menu_search` | where a dish is served on a day |
| `dining_list_eateries` | every eatery's hours for a day |
| `gym_occupancy` | live headcount and percent full at each fitness center |
| `gym_schedule` | gym hours and today's group fitness classes |

To add it to Claude, go to Settings → Connectors → Add custom connector and enter the URL above.

`lib/` is the cornell-campus skill's data code, with two changes for Workers:
- The curl/proxy fetch path (needs `node:child_process`) and `process.env` overrides are removed.
- The dining feed URL moved from `now.dining.cornell.edu/api/...`, which now returns the web app's HTML, to
  `admin-now.dining.cornell.edu/api/1.0/dining/eateries.json`.

Data sources: admin-now.dining.cornell.edu, goboardapi.azurewebsites.net (gym headcounts),
scl.cornell.edu (gym hours and classes). Results are cached in memory per Worker isolate (10 min dining,
1 min headcounts, 30 min gym page).

Test locally with Node 18+:

```bash
node -e "import('./functions/mcp.js').then(async ({onRequest}) => { const r = await onRequest({request: new Request('https://x/mcp', {method: 'POST', body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'tools/call', params: {name: 'dining_open_now', arguments: {}}})})}); console.log(await r.text()); })"
```
