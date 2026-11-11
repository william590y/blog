---
layout: post
title: "Scriptorium"
permalink: /scriptorium
project: true   # project pages get the Yinit drop cap, like blog posts
author: William
---

A fancy and sophisticated obsidian configuration for the typographically inclined

<div style="display:flex;align-items:center;gap:0.65rem;margin:1.5rem 0 0.5rem;">
  <label style="display:flex;align-items:center;gap:0.55rem;cursor:pointer;"><input type="checkbox" id="scriptorium-fancy-toggle" class="ink-check"> <strong>Fancy mode</strong></label>
</div>
<figure style="margin:1rem 0 2rem;">
  <a id="scriptorium-preview-link" href="{{ '/assets/images/scriptorium-normal-type.png' | relative_url }}?v={{ site.time | date: '%s' }}"><img id="scriptorium-preview" src="{{ '/assets/images/scriptorium-normal-type.png' | relative_url }}?v={{ site.time | date: '%s' }}" data-fancy="{{ '/assets/images/scriptorium-fancy-type.png' | relative_url }}?v={{ site.time | date: '%s' }}" data-normal="{{ '/assets/images/scriptorium-normal-type.png' | relative_url }}?v={{ site.time | date: '%s' }}" alt="Scriptorium in Obsidian with Fancy mode off: centered small-cap headings, bordered quotations and a Yinit drop cap, in light mode." width="1058" height="1199" style="display:block;width:100%;height:auto;"></a>
  <figcaption id="scriptorium-preview-caption" aria-live="polite" style="font-size:0.85em;text-align:center;margin-top:0.75rem;">Fancy mode off — centered small-cap headings, bordered quotations and a Yinit drop cap. Captured in Obsidian, light mode.</figcaption>
</figure>
<script src="{{ '/assets/scriptorium-preview.js' | relative_url }}?v={{ site.time | date: '%s' }}" defer></script>
<noscript><p><a href="{{ '/assets/images/scriptorium-normal-type.png' | relative_url }}?v={{ site.time | date: '%s' }}">View the compact style</a></p></noscript>

Bookish serif typography, warm paper, centered small-cap headings, italic subtitles, ornamental Yinit drop caps, and floral scene breaks. Includes the Typewriter theme, a custom manuscript stylesheet, and writing plugins.

<a href="{{ '/assets/downloads/Scriptorium.zip' | relative_url }}" download>Download the Obsidian configuration</a>

### Fancy mode

Fancy mode starts **off**, with centered small-cap section headings and bordered quotations. Turn it on for quiet italic quotations and justified openings. Both modes open chapters with an ornamental Yinit initial. Images are centred; to place one, add `left`, `right` or `center` before the size, as in `![[image.png|left|300]]`. Links are inked like the ones on this site. **Both modes use the same 1.45 line spacing.**

In Obsidian, go to **Settings → Scriptorium → Fancy mode**. You can also click the **feather icon**, click **Fancy mode: on/off** in the status bar, or use **Scriptorium: Toggle fancy mode** in the command palette. Your choice is remembered for that vault.

The preview switch above compares real screenshots of the two modes.

[Instructions for agents]({{ '/assets/downloads/Scriptorium-Agents.txt' | relative_url }})

### Easy setup

Download the installer for your operating system. It checks for Obsidian and installs it if needed, installs missing EB Garamond and Cormorant Garamond fonts, then creates a new Scriptorium vault with the Lorem Ipsum sample. When Obsidian opens, choose **Open folder as vault** and select the folder printed by the installer.

- <a href="{{ '/assets/downloads/Scriptorium-Setup.exe' | relative_url }}" download>Windows installer</a> — open `Scriptorium-Setup.exe`, choose the vault folder and click **Install**. If Windows says it protected your PC, choose **More info**, then **Run anyway**. Prefer a script? Use the <a href="{{ '/assets/downloads/Install-Scriptorium-Windows.cmd' | relative_url }}" download>command-line installer</a>.
- <a href="{{ '/assets/downloads/Install-Scriptorium-macOS.command' | relative_url }}" download>macOS installer</a> — run `bash ~/Downloads/Install-Scriptorium-macOS.command` in Terminal.
- <a href="{{ '/assets/downloads/Install-Scriptorium-Linux.sh' | relative_url }}" download>Linux installer</a> — run `bash ~/Downloads/Install-Scriptorium-Linux.sh` in Terminal. Requires `curl` and `unzip`. New Linux installs use the official x86-64 or ARM64 AppImage and require AppImage support.

Restart any running Obsidian windows after installation so newly installed fonts are loaded.

### Manual setup

The download includes a Lorem Ipsum sample with a title, subtitle, quotation, and headers. Extract the ZIP and open its folder as a vault in Obsidian. Install **EB Garamond** and **Cormorant Garamond** for the intended typography, then open **Lorem Ipsum** in Reading view. Setup instructions are included. Enable the bundled community plugins to use the Fancy mode switch.
