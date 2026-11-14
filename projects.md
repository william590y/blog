---
layout: post
title: "Projects"
permalink: /projects/
author: William
---

## [Scriptorium — Obsidian configuration]({{ '/scriptorium' | relative_url }})

A fancy and sophisticated obsidian configuration for the typographically inclined

<a href="{{ '/scriptorium' | relative_url }}" aria-label="Explore Scriptorium and Lagrange"><picture><source srcset="{{ '/assets/images/lagrange-poster.png' | relative_url }}?v=lg061" media="(prefers-reduced-motion: reduce)"><img src="{{ '/assets/images/lagrange.gif' | relative_url }}?v=lg061" alt="Lagrange at work in Obsidian: the editor with a subtitle, its rule and a drop cap; a request is typed in its panel, a pen flies to the note, strikes out the old words and writes the new ones in handwriting, draws an equation, a small typewriter types a block of code, the pen draws a diagram, and a reply is set with mathematics, code and a figure." width="840" height="541" loading="lazy" style="display:block;width:100%;height:auto;border:1px solid var(--border);"></picture></a>

*Lagrange, Scriptorium's writing companion, editing a note with its pen. Recorded in Obsidian.*

Scriptorium comes with **Lagrange**, a writing companion that lives beside the note. Ask it a question and it answers; ask for a change and it makes it in the note with a fountain pen: the old words are struck through, the new ones written in by hand, equations drawn symbol by symbol and code typed on a small typewriter. Every run of edits can be undone and redone, and the conversation can be rewound to any earlier message, the note with it. It works with a Claude or ChatGPT subscription, an API key, a local model, or offline in a demo mode.

New in 1.2: a drop cap of its own for any note, from several sets or your own images; one-step setup in a vault you already have; and an experimental backup of a vault to Google Drive.

[See the preview and download Scriptorium →]({{ '/scriptorium' | relative_url }})

---

## [Cornell connector — campus data for Claude]({{ '/cornell' | relative_url }})

A connector that lets Claude look up live Cornell and Ithaca information

Ask Claude what the dining halls are serving, how busy the gyms are, when a class meets or whether a library is open, and it looks up the answer. The connector covers dining, gyms, the Class Roster, library hours, campus events, TCAT buses, the weather, the academic calendar, the campus map and CUGIR geodata, and, once its key is added, bird sightings from eBird. It reads public sources only; nothing needs a Cornell login.

To add it to Claude, open **Settings → Connectors → Add custom connector** and enter `https://williamliaw.com/mcp`.

[See what it covers and how to add it →]({{ '/cornell' | relative_url }})
