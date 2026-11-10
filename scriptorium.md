---
layout: post
title: "Scriptorium"
permalink: /scriptorium
author: William
---

A fancy and sophisticated obsidian configuration for the typographically inclined

<div style="display:flex;align-items:center;gap:0.65rem;margin:1.5rem 0 0.5rem;">
  <label style="display:flex;align-items:center;gap:0.55rem;cursor:pointer;"><input type="checkbox" id="scriptorium-fancy-toggle" checked style="width:1.15rem;height:1.15rem;accent-color:#8b2323;"> <strong>Fancy mode</strong></label>
</div>
<figure style="margin:1rem 0 2rem;">
  <a id="scriptorium-preview-link" href="{{ '/assets/images/scriptorium-fancy-mode.png' | relative_url }}"><img id="scriptorium-preview" src="{{ '/assets/images/scriptorium-fancy-mode.png' | relative_url }}" data-fancy="{{ '/assets/images/scriptorium-fancy-mode.png' | relative_url }}" data-normal="{{ '/assets/images/scriptorium-normal-mode.png' | relative_url }}" alt="Scriptorium in Obsidian with Fancy mode on: original airy spacing and italic quotations." width="1058" height="1199" style="display:block;width:100%;height:auto;"></a>
  <figcaption id="scriptorium-preview-caption" aria-live="polite" style="font-size:0.85em;text-align:center;margin-top:0.75rem;">Fancy mode on — original airy spacing and quiet italic quotations. Captured in Obsidian.</figcaption>
</figure>
<script src="{{ '/assets/scriptorium-preview.js' | relative_url }}" defer></script>
<noscript><p><a href="{{ '/assets/images/scriptorium-normal-mode.png' | relative_url }}">View Fancy mode off</a></p></noscript>

Bookish serif typography, warm paper, centered small-cap headings, italic subtitles, drop caps, and ornamental scene breaks. Includes the Typewriter theme, a custom manuscript stylesheet, and writing plugins.

<a href="{{ '/assets/downloads/Scriptorium.zip' | relative_url }}" download>Download the Obsidian configuration</a>

### Fancy mode

Fancy mode starts **on**, giving you the original airy line spacing and quiet italic quotations. Turn it off for tighter line spacing and bordered quotations.

In Obsidian, go to **Settings → Scriptorium → Fancy mode**. You can also click the **feather icon**, click **Fancy mode: on/off** in the status bar, or use **Scriptorium: Toggle fancy mode** in the command palette. Your choice is remembered for that vault.

The preview switch above compares real screenshots of the two modes.

### Easy setup

Download the installer for your operating system. It creates a new vault with the configuration and a Lorem Ipsum demonstration, then opens it in Obsidian. Existing vaults are preserved.

- <a href="{{ '/assets/downloads/Install-Scriptorium-Windows.cmd' | relative_url }}" download>Windows installer</a> — open the downloaded `.cmd` file.
- <a href="{{ '/assets/downloads/Install-Scriptorium-macOS.command' | relative_url }}" download>macOS installer</a> — run `bash ~/Downloads/Install-Scriptorium-macOS.command` in Terminal.
- <a href="{{ '/assets/downloads/Install-Scriptorium-Linux.sh' | relative_url }}" download>Linux installer</a> — run `bash ~/Downloads/Install-Scriptorium-Linux.sh` in Terminal. Requires `curl` and `unzip`.

If Obsidian is missing, the installer opens its official download page. Install it, then open the new vault folder. Install **EB Garamond** and **Cormorant Garamond** for the intended fonts.

### Manual setup

The download includes a Lorem Ipsum sample with a title, subtitle, quotation, and headers. Extract the ZIP and open its folder as a vault in Obsidian. Install **EB Garamond** and **Cormorant Garamond** for the intended typography, then open **Lorem Ipsum** in Reading view. Setup instructions are included. Enable the bundled community plugins to use the Fancy mode switch.
