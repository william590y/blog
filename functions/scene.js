// https://williamliaw.com/scene -> the scene class demo on its current Cloudflare quick tunnel.
// Logic and the /live/scene.json format: demo_links/redirect.mjs and demo_links/README.md.
import { handle } from '../demo_links/redirect.mjs';

export const onRequest = (context) => handle(context, 'scene');
