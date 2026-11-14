---
layout: post
title: "Cornell connector"
permalink: /cornell
project: true   # project pages get the Yinit drop cap, like blog posts
author: William
---

A connector that lets Claude look up live Cornell and Ithaca information: what the dining halls are serving, how full the gyms are, when a class meets, whether Olin is open, when the next bus leaves. It reads public pages and feeds only, and it is not an official Cornell service.

### Adding it to Claude

In Claude, open **Settings → Connectors → Add custom connector** and enter the address `https://williamliaw.com/mcp`. There is no sign-in. Then ask in plain words ("what's for dinner on West?", "is Teagle busy?", "is a study room free in Olin at three?") and Claude picks the tool.

### What it covers

- **Dining.** What is open now or at a given time, every dining hall's menu by station, one eatery's hours and menu, and where a dish is being served.
- **Gyms.** The live headcount and percent full at each fitness center, posted hours, and the day's group fitness classes.
- **Classes.** The Class Roster for any term: classes in a subject by keyword, level or instructor, and one course's description, prerequisites, sections, meeting times, instructors and whether each section is open, closed or waitlisted.
- **Libraries.** Hours for each library and its service desks, what is open now, and a library's hours for the week ahead.
- **Study rooms.** The library's bookable rooms with their free times for a day, and, for a room and time you choose, a link that opens the library's booking page on that date for you to sign in and confirm.
- **Campus rooms.** Classrooms and event spaces in 25Live: capacity, equipment, what is scheduled in a room on a day, and a link to its page for requesting it.
- **Events.** The university events calendar by date, keyword, type, department or place.
- **Buses.** The next TCAT departures at a stop with live estimates, the stops nearest a building, and current detours.
- **Weather.** Current conditions, the National Weather Service forecast and any active alerts for Ithaca.
- **Academic calendar.** The Registrar's dates: breaks, add and drop deadlines, exams, enrollment.
- **Campus map.** Where a building or parking lot is, with its address and walking directions.
- **Birds.** Recent and notable sightings near campus, at a hotspot such as Sapsucker Woods or across Tompkins County, from eBird. These tools wait on an eBird key for the server; until it is added they say so.
- **Geodata.** CUGIR, the library's repository of New York State geospatial data: search, formats, extents and download links.

### What it does not do

It cannot see anything behind a Cornell login, and it never signs in for you. It shows which rooms are free but does not book one: it hands you a link, and the room is yours only after you sign in and confirm on the library's or 25Live's own page. It does not look up people, read your schedule, enroll you in a class or search the library catalog. The Class Roster's public listing has no seat counts and no rooms, the campus map has parking lots but not whether they are full, and gym hours are the regular semester hours as posted.

### Sources

Cornell Dining, Cornell Fitness Centers, the [Class Roster](https://classes.cornell.edu), [Cornell University Library](https://www.library.cornell.edu) and its [room booking site](https://spaces.library.cornell.edu), [Scheduling@Cornell](https://scheduling.cornell.edu) (25Live), the [events calendar](https://events.cornell.edu), [CUGIR](https://cugir.library.cornell.edu), [eBird](https://ebird.org), [TCAT](https://tcatbus.com), the [National Weather Service](https://www.weather.gov), the [Registrar](https://registrar.cornell.edu/academic-calendar) and the [campus map](https://www.cornell.edu/about/maps/). Answers are fetched when asked and cached for a few minutes.

The code and the list of tools are [on GitHub](https://github.com/william590y/blog/tree/gh-pages/cornell_mcp).
