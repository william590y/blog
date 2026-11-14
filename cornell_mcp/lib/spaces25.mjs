// Campus rooms in 25Live (Scheduling@Cornell, 25live.collegenet.com/pro/cornell): classrooms,
// meeting rooms and event spaces. Scheduling@Cornell sends every visitor to Cornell's sign-in
// before it shows anything, so this server does not read it at all: no room search, no
// calendars. (Its data service does answer some requests without a session, but the site's
// front door requires a NetID, and this server does not go around a sign-in.) The one tool here
// hands the person a link to 25Live and the steps to request a room themselves.

import { InputError, easternDate, easternToEpoch, fmtTime, intArg, parseTimeOfDay, resolveDate, truncate } from './util.mjs';

const PRO = 'https://25live.collegenet.com/pro/cornell';
const HELP = 'https://scheduling.cornell.edu';
export const NOT_REQUESTED =
  "NOT BOOKED. Nothing has been requested or reserved, and this server has not checked whether the room is free (25Live shows its calendars only after a Cornell sign-in). The person must open 25Live, sign in with their Cornell NetID and submit the request themselves; the location's scheduler then approves or declines it.";

export async function campusRoomBookingLink(args = {}, nowMs = Date.now()) {
  const room = truncate(String(args.space ?? '').trim(), 80);
  if (!room) throw new InputError('space is required: the room the person wants, e.g. "Gates Hall G01" or "Willard Straight Memorial Room".');
  const day = resolveDate(args.date, nowMs);
  if (day.iso < easternDate(nowMs)) throw new InputError('Pick today or a future date.');
  let time = null;
  if (args.start) {
    const t = parseTimeOfDay(args.start);
    if (!t) throw new InputError(`Could not understand start "${args.start}". Try "2pm" or "14:00".`);
    const minutes = intArg(args.duration_minutes, 60, 15, 16 * 60);
    const a = easternToEpoch(day.y, day.m, day.d, t.h, t.m);
    time = `${fmtTime(a)}-${fmtTime(a + minutes * 60000)}`;
  }
  const whenText = time ? `${day.iso}, ${time}` : day.iso;
  return {
    status: NOT_REQUESTED,
    link: PRO,
    link_opens: 'Scheduling@Cornell (25Live), which asks for a Cornell sign-in first. 25Live takes no room, date or time in a link, so they are entered after signing in.',
    request: { space: room, date: day.iso, ...(time ? { time } : {}) },
    availability_check: 'Not checked: room calendars in 25Live are visible only after signing in. The Availability view in 25Live shows them.',
    steps: [
      'Open the link and sign in with your Cornell NetID (and Duo).',
      `Search for the location "${room}" and open its Availability view to see whether ${whenText} is free.`,
      `Start an event request for that location (the Event Form) and enter the event name, type, expected head count, date and time (${whenText}).`,
      'Save the request. It goes to the scheduler for that location (the site says to allow up to 5 business days); the space is yours only when the scheduler confirms it.',
    ],
    summary: `Prepared, not requested: ${room} on ${whenText}. Open 25Live, sign in, check the room's availability and submit the request to ask for it.`,
    who_can_request: `Anyone with a Cornell NetID can sign in to Scheduling@Cornell and submit a request; each location's scheduler reviews it. See ${HELP}.`,
    source: `${HELP} (Scheduling@Cornell)`,
  };
}
