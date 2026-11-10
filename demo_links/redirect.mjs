// Permanent links for the Splash class demos: https://williamliaw.com/listen and https://williamliaw.com/scene.
//
// Each demo runs as a Slurm job behind two Cloudflare quick tunnels (random https://<name>.trycloudflare.com hosts,
// a primary and a hot backup) that change with every job. The job commits its current hosts to /live/<demo>.json
// (see demo_links/README.md). These Pages Functions read that file from the same deployment and 302-redirect to the
// first host whose /healthz answers, keeping the query string. The URL fragment (#k=..., #wk=...: the phones' keys)
// is never sent to any server: the browser re-attaches it to the redirect target by itself (RFC 9110 10.2.2).
//
// Only https://<name>.trycloudflare.com hosts are ever redirected to (no open redirect). With no live host the
// function serves a small page that opens the demo by itself once it is up.

export const DEMOS = {
  listen: { name: 'The listening room', path: '/join' },
  scene: { name: 'The scene demo', path: '/' },
};

const HOST_RE = /^https:\/\/([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.trycloudflare\.com\/?$/;
const PATH_RE = /^\/(?!\/)[A-Za-z0-9._~\/-]{0,200}$/;
const MAX_HOSTS = 4;
export const PROBE_TIMEOUT_MS = 2500;

// The canonical form of an allowed host, or null for anything else.
export function cleanHost(value) {
  if (typeof value !== 'string') return null;
  const m = HOST_RE.exec(value);
  return m ? `https://${m[1]}.trycloudflare.com` : null;
}

// {state, hosts, path, updated} from the rendezvous JSON; anything malformed reads as offline.
export function parseRendezvous(data, demo) {
  const out = { state: 'offline', hosts: [], path: DEMOS[demo].path, updated: null };
  if (!data || typeof data !== 'object' || Array.isArray(data)) return out;
  if (Array.isArray(data.hosts)) {
    for (const h of data.hosts) {
      const c = cleanHost(h);
      if (c && !out.hosts.includes(c)) out.hosts.push(c);
      if (out.hosts.length >= MAX_HOSTS) break;
    }
  }
  if (typeof data.path === 'string' && PATH_RE.test(data.path)) out.path = data.path;
  if (typeof data.updated === 'string') out.updated = data.updated.slice(0, 40);
  if (data.state === 'live' && out.hosts.length) out.state = 'live';
  return out;
}

async function readRendezvous(context, demo) {
  try {
    const res = await context.env.ASSETS.fetch(new URL(`/live/${demo}.json`, context.request.url).toString());
    return parseRendezvous(res.ok ? await res.json() : null, demo);
  } catch {
    return parseRendezvous(null, demo);
  }
}

// HTTP status of host/healthz, or 0 if it did not answer within PROBE_TIMEOUT_MS.
async function probe(host, doFetch) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await doFetch(`${host}/healthz`, {
      redirect: 'manual',
      signal: ctrl.signal,
      headers: { 'user-agent': 'williamliaw.com class-demo link check' },
    });
    try {
      await res.body?.cancel();
    } catch {}
    return res.status;
  } catch {
    return 0;
  } finally {
    clearTimeout(timer);
  }
}

// The first host answering 200, else the first answering 429 (a quick tunnel at its request cap is up, not dead).
async function pickHost(hosts, doFetch) {
  const probes = hosts.map((h) => probe(h, doFetch));
  let busy = null;
  for (let i = 0; i < hosts.length; i++) {
    const status = await probes[i];
    if (status === 200) return hosts[i];
    if (status === 429 && !busy) busy = hosts[i];
  }
  return busy;
}

const BASE_HEADERS = {
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-robots-tag': 'noindex',
  'x-content-type-options': 'nosniff',
};

const CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; " +
  "base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function page(demo, info, kind) {
  const { name } = DEMOS[demo];
  const offline = kind === 'offline';
  const heading = offline ? "The class demo isn't running right now" : 'Connecting to the class demo…';
  const text = offline
    ? `${name} only runs during the class. Keep this page open: it opens the demo by itself as soon as it starts.`
    : `${name} is restarting or busy. This page keeps trying by itself.`;
  // A stale permanent link (Cloudflare slow to deploy a new host) must not strand a student in a running class.
  const qr = 'Class already started? Scan the QR code on the projector screen.';
  // Hosts are validated (https://[a-z0-9-]+.trycloudflare.com) and the path is [A-Za-z0-9._~/-]: safe in a script.
  const cfg = JSON.stringify({ demo, kind, hosts: info.hosts, path: info.path });
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(name)}</title>
<style>
:root{color-scheme:light dark;--bg:#f7f6f2;--fg:#1d1d1f;--mute:#5f5f66;--btn:#1d4ed8}
@media (prefers-color-scheme:dark){:root{--bg:#141416;--fg:#ececf1;--mute:#a1a1aa;--btn:#3b82f6}}
body{margin:0;background:var(--bg);color:var(--fg);font:17px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:30rem;margin:18vh auto 0;padding:0 16px}h1{font-size:1.45rem;line-height:1.25;margin:0 0 .6em}
p{margin:0 0 1em;color:var(--mute)}a.b{display:inline-block;margin:.2em .4em .4em 0;padding:.55em 1em;border-radius:8px;
background:var(--btn);color:#fff;text-decoration:none}#s{font-size:.85rem}
</style></head><body><main><h1>${esc(heading)}</h1><p>${esc(text)}</p><p>${esc(qr)}</p><p id="x"></p><p id="s"></p></main>
<script>
(() => {
  const C = ${cfg};
  const s = document.getElementById('s'), x = document.getElementById('x');
  if (C.kind === 'offline') {
    let busy = false;
    const check = async () => {
      if (busy || document.hidden) return;
      busy = true;
      try {
        const r = await fetch('/live/' + C.demo + '.json', { cache: 'no-store' });
        const j = await r.json();
        if (j && j.state === 'live' && Array.isArray(j.hosts) && j.hosts.length) { s.textContent = 'Starting…'; location.reload(); }
      } catch (e) {}
      busy = false;
    };
    setInterval(check, 10000);
    document.addEventListener('visibilitychange', check);
  } else {
    let n = 0;
    try { n = Number(sessionStorage.getItem('demo-tries-' + C.demo)) || 0; sessionStorage.setItem('demo-tries-' + C.demo, n + 1); } catch (e) {}
    s.textContent = n ? 'Tried ' + (n + 1) + ' times.' : '';
    if (n >= 2) {
      C.hosts.forEach((h, i) => {
        const a = document.createElement('a');
        a.className = 'b';
        a.textContent = i ? 'Try the backup link' : 'Open the demo anyway';
        a.href = h + C.path + location.search + location.hash;
        x.appendChild(a);
      });
    }
    setTimeout(() => location.reload(), 5000);
  }
})();
</script></body></html>
`;
  return new Response(html, {
    // 200 even when unreachable: some in-app browsers (QR scanner apps) show their own error screen for a 5xx.
    status: 200,
    headers: {
      ...BASE_HEADERS,
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': CSP,
      'x-demo-state': offline ? 'offline' : 'unreachable',
    },
  });
}

// GET /live/status/<demo> (functions/live/status/[demo].js): what the permanent link does right now, as CORS JSON.
// The demos' projector checks read it, so their QR falls back to the direct tunnel link whenever the function itself
// is broken or the link would not lead to their server (the static /live/<demo>.json can be fine while it is).
// {demo, state: live|offline|unreachable, host: the tunnel the link redirects to now (or null), hosts, updated}
export async function status(context, demo, options = {}) {
  const { request } = context;
  const cors = {
    ...BASE_HEADERS,
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, HEAD, OPTIONS',
  };
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (!Object.prototype.hasOwnProperty.call(DEMOS, demo)) {
    return new Response('{"error":"unknown demo"}\n', { status: 404, headers: { ...cors, 'content-type': 'application/json' } });
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed\n', { status: 405, headers: { ...cors, allow: 'GET, HEAD, OPTIONS' } });
  }
  const doFetch = options.fetch || ((...args) => fetch(...args));
  const info = await readRendezvous(context, demo);
  const host = info.state === 'live' ? await pickHost(info.hosts, doFetch) : null;
  const state = info.state !== 'live' ? 'offline' : host ? 'live' : 'unreachable';
  const body = JSON.stringify({ demo, state, host, hosts: info.hosts, updated: info.updated }) + '\n';
  const headers = { ...cors, 'content-type': 'application/json; charset=utf-8', 'x-demo-state': state };
  return new Response(request.method === 'HEAD' ? null : body, { status: 200, headers });
}

export async function handle(context, demo, options = {}) {
  const { request } = context;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed\n', { status: 405, headers: { ...BASE_HEADERS, allow: 'GET, HEAD' } });
  }
  const doFetch = options.fetch || ((...args) => fetch(...args));
  const info = await readRendezvous(context, demo);
  let res;
  if (info.state !== 'live') {
    res = page(demo, info, 'offline');
  } else {
    const host = await pickHost(info.hosts, doFetch);
    res = host
      ? new Response(null, {
          status: 302,
          headers: { ...BASE_HEADERS, location: host + info.path + new URL(request.url).search, 'x-demo-state': 'live' },
        })
      : page(demo, info, 'unreachable');
  }
  return request.method === 'HEAD' ? new Response(null, { status: res.status, headers: res.headers }) : res;
}
