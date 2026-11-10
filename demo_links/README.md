# Class-demo links: /listen and /scene

Permanent links for the two Splash class demos (M1237, Nov 21 2026), safe to print on QR codes and seat cards:

| link | demo | redirects to |
|---|---|---|
| https://williamliaw.com/listen | the listening room | `https://<host>/join` + the query string |
| https://williamliaw.com/scene | the scene demo (either variant) | `https://<host>/` + the query string |

Each demo runs as a Slurm job behind two Cloudflare quick tunnels, a primary and a hot backup. Their random
`https://<name>.trycloudflare.com` hosts change with every job, so the job publishes its current hosts to a small
rendezvous file in this repo, and the Pages Functions `functions/listen.js` and `functions/scene.js` (logic in
`redirect.mjs`) send phones there.

## Rendezvous files: `/live/listen.json`, `/live/scene.json`

```json
{
  "demo": "listen",
  "state": "live",
  "hosts": ["https://primary-name.trycloudflare.com", "https://backup-name.trycloudflare.com"],
  "updated": "2026-11-21T19:58:03Z"
}
```

- `state` is `live` or `offline`; `hosts` is in order of preference (primary first). Only tunnel hostnames and states
  go here: no tokens, keys, admin/projector links or student data.
- Optional `path` overrides the join path (`[A-Za-z0-9._~/-]`, starting with a single `/`).
- `_headers` serves `/live/*` with `Access-Control-Allow-Origin: *` and `Cache-Control: no-store`, so a phone page on a
  tunnel host can poll it with a simple CORS GET (no custom request headers, so no preflight) to find a replacement
  job when both of its tunnels die:
  `fetch('https://williamliaw.com/live/listen.json', {cache: 'no-store'}).then(r => r.json())`.
- The jobs update these files with `/share/thickstun/wjl86/splash_links/publish_host.sh` on the cluster (a data-only
  commit straight to gh-pages; Cloudflare Pages redeploys in about 80 s). Do not edit them by hand during a class.

## What the functions do

1. Read `/live/<demo>.json` from the same deployment (`env.ASSETS`), keeping only hosts that match
   `https://<name>.trycloudflare.com` exactly. Anything else is ignored, so the links can never redirect elsewhere.
2. `offline`, or no allowed host: a small page, "The class demo isn't running right now", that polls the rendezvous
   file every 10 s and reloads itself once the demo is live (HTTP 200, `x-demo-state: offline`).
3. `live`: probe every host's `/healthz` in parallel (2.5 s timeout) and 302 to the first one answering 200 (else the
   first answering 429: a quick tunnel at its request cap is up). The `Location` has no fragment, so the browser keeps
   the original one (`#k=...`, `#wk=...`): keys stay on the phone and never reach Cloudflare's function or GitHub.
4. `live` but no host answers: a "Connecting to the class demo..." page that retries every 5 s and, after two retries,
   offers direct links built in the browser with the fragment (HTTP 200, `x-demo-state: unreachable`).

Every response is `Cache-Control: no-store`, so a newly published host takes effect as soon as the deploy finishes.
