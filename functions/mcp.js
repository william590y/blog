// Cornell campus MCP server: live Cornell Dining hours, menus and dish search, plus gym crowding
// and hours. A Cloudflare Pages Function served at https://williamliaw.com/mcp, speaking MCP's
// Streamable HTTP transport statelessly: every POST carries JSON-RPC and gets a JSON reply, with
// no sessions and no SSE stream. Add it in Claude under Settings -> Connectors -> Add custom
// connector, URL https://williamliaw.com/mcp, no authentication.
//
// The data code in /cornell_mcp/lib is the cornell-campus skill's, ported to Workers.

import {
  diningEatery,
  diningListEateries,
  diningMenuSearch,
  diningOpenNow,
} from '../cornell_mcp/lib/dining.mjs';
import { gymOccupancy, gymSchedule } from '../cornell_mcp/lib/gym.mjs';
import { InputError } from '../cornell_mcp/lib/util.mjs';

const SERVER_INFO = { name: 'cornell-campus', title: 'Cornell Campus', version: '0.1.0' };
const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

const INSTRUCTIONS = `Live Cornell University dining and gym data. Always call a tool instead of answering from memory: hours, menus and crowd levels change by semester, break and day.
- All times are Ithaca local time. Dates accept today, tomorrow, a weekday name or YYYY-MM-DD; times accept 7pm or 19:00. Areas: North, West, Central.
- "Dining hall" means type "dining room" (all-you-care-to-eat, takes meal swipes). Cafes, coffee shops and markets mostly take BRBs/Cornell Card; check accepts_swipes.
- Nicknames work: Okies (Okenshields), RPME (Robert Purcell), Appel (North Star), Morrison, Becker/Cook/Rose/Keeton/Bethe (West Campus houses), 104West (kosher/multicultural).
- If nothing is open, lead with what opens next (opening_soon). If a result notes unpublished dates, say hours or menus are not out yet.
- Gym level: quiet < 25% <= moderate < 50% <= busy < 75% <= very busy. Give the headcount and percent, not only the label. If minutes_since_update > 20 while open, say the count may be stale. "closed" means closed: report the next opening. Gym hours are regular-semester hours; breaks may differ.
- Summarize menus (main entrees, stations, notable vegetarian items) unless the full menu is asked for. Lead with the answer and keep it short.
- If a tool reports a source error, say so and point to https://now.dining.cornell.edu or https://scl.cornell.edu/recreation/cornell-fitness-centers.`;

const DATE = { type: 'string', description: 'today, tomorrow, a weekday name, or YYYY-MM-DD (default today)' };
const AREA = { type: 'string', description: 'Campus area: North, West or Central' };
const TYPE = {
  type: 'string',
  description: 'Eatery type, e.g. "dining hall" (all-you-care-to-eat), "cafe", "coffee shop", "market"',
};
const MEAL = { type: 'string', description: 'Breakfast, Brunch, Lunch, Dinner or Late Night' };
const SWIPES = { type: 'boolean', description: 'Only eateries that take meal swipes' };
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
    name: 'dining_eatery',
    title: 'One eatery: hours and menu',
    description:
      "One Cornell eatery's hours and menu for a day, e.g. Okies dinner tonight. Accepts nicknames (Okies, RPME, Appel).",
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
    description: 'Find which Cornell eateries serve a dish or ingredient on a day, e.g. "where\'s ramen today".',
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

async function callTool(params) {
  const tool = TOOL_BY_NAME.get(params?.name);
  if (!tool) return { error: { code: -32602, message: `Unknown tool: ${params?.name}` } };
  const args = params.arguments && typeof params.arguments === 'object' ? params.arguments : {};
  try {
    const result = await tool.run(args);
    return { result: { content: [{ type: 'text', text: JSON.stringify(result) }], isError: false } };
  } catch (err) {
    const text =
      err instanceof InputError
        ? err.message
        : `${err.message}. Fallback pages: https://now.dining.cornell.edu (dining), https://scl.cornell.edu/recreation/cornell-fitness-centers (gyms)`;
    return { result: { content: [{ type: 'text', text }], isError: true } };
  }
}

async function handle(msg) {
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
      const r = await callTool(params);
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

export async function onRequest({ request }) {
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
    const replies = (await Promise.all(body.map(handle))).filter(Boolean);
    return replies.length ? json(replies) : new Response(null, { status: 202, headers: CORS });
  }
  const reply = await handle(body);
  return reply ? json(reply) : new Response(null, { status: 202, headers: CORS });
}
