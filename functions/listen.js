// https://williamliaw.com/listen -> the listening-room class demo on its current Cloudflare quick tunnel.
// Logic and the /live/listen.json format: demo_links/redirect.mjs and demo_links/README.md.
import { handle } from '../demo_links/redirect.mjs';

export const onRequest = (context) => handle(context, 'listen');
