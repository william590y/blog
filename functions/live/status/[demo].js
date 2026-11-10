// https://williamliaw.com/live/status/<listen|scene>: where the permanent link leads right now, as CORS JSON (the class
// demos' projector QR checks read it). Logic: demo_links/redirect.mjs `status`; format: demo_links/README.md.
import { status } from '../../../demo_links/redirect.mjs';

export const onRequest = (context) => status(context, String(context.params.demo || ''));
