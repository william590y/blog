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

<a href="{{ '/assets/downloads/Scriptorium.zip' | relative_url }}?v=855ceb85" download>Download the Obsidian configuration</a>

### Lagrange

<figure style="margin:1rem 0 1.5rem;">
  <video controls muted loop playsinline preload="none" poster="{{ '/assets/images/lagrange-poster.png' | relative_url }}?v=lg030" width="1180" height="760" style="display:block;width:100%;height:auto;border:1px solid var(--border);" aria-label="Lagrange at work in Obsidian: a typed request, the pen striking out and writing in handwriting, an equation drawn, code typed by a typewriter, then undo, redo and a rewind">
    <source src="{{ '/assets/images/lagrange.mp4' | relative_url }}?v=lg030" type="video/mp4">
    <a href="{{ '/assets/images/lagrange.gif' | relative_url }}?v=lg030">Watch Lagrange at work (GIF)</a>
  </video>
  <figcaption style="font-size:0.85em;text-align:center;margin-top:0.75rem;">Lagrange editing a note. Recorded in Obsidian with its offline demo, so you can try the same without an account. <a href="{{ '/assets/images/lagrange.gif' | relative_url }}?v=lg030">As a GIF</a>.</figcaption>
</figure>

Lagrange is Scriptorium's writing companion. Click the **pen-nib icon** to open it beside your note and type.

- **It answers and it edits.** A question gets an answer. A request for a change ("fix the grammar", "tighten the second paragraph", "add the equation for kinetic energy") is carried out in the note.
- **Edits are made by pen.** The old words are struck through and the new ones written in by hand, with a thin trail of ink behind the nib. An equation is typeset and drawn symbol by symbol. Code is typed on a small typewriter.
- **Nothing is lost.** One Undo takes back all the edits of a request, and the arrows at the head of the panel undo and redo Lagrange's edits run by run, keeping anything you typed since. The small clock beside each of your messages rewinds the conversation, and the note, to that point.
- **Your model.** It uses your Claude subscription by default (through Claude Code), or a ChatGPT subscription (through Codex), an Anthropic or OpenAI API key, or a local model. Choose the model and how hard it thinks at the foot of the panel. **Demo (offline)** needs no account.

Lagrange sends the open note and your message to the provider you chose, only when you ask it something.

### Drop caps

Chapters open with an ornamental Yinit initial. **Settings → Scriptorium → Drop cap** offers other sets (Goudy Initialen, Kanzlei, Deutsche Zierschrift, and the picture initials gwern.net made), a plain capital, or none, and one note can have its own: run **Scriptorium: Choose the drop cap for this note**. You can add your own set, images or a font of initials, with **Scriptorium: Add a set of drop caps**; one-colour images take the page's accent colour in the light and the dark theme. Lagrange can draw an initial for you (**Lagrange: Draw a drop cap**) through your Claude or ChatGPT subscription; drawing with OpenAI's image model is experimental. **Export to PDF** keeps the title and the drop caps.

### A vault you already have

Scriptorium can be added to any vault, or to a folder of notes, in one step. In a Scriptorium vault run **Scriptorium: Set up another vault**; on Windows open the installer, choose the vault's folder and click **Set up**; on any system run <a href="{{ '/assets/downloads/Setup-Scriptorium-Vault.py' | relative_url }}?v=020626b5" download>Setup-Scriptorium-Vault.py</a> with Python (`python3 Setup-Scriptorium-Vault.py /path/to/vault`). Each shows what it will change before it changes anything. Your notes are not touched, your own plugins and settings are kept, and the vault's `.obsidian` folder is copied to a backup first.

### Backing up to Google Drive (experimental)

If your Claude account is connected to Google Drive, **Scriptorium: Back up this vault to Google Drive** keeps a copy of the vault in a Drive folder, **Sync now** brings the two up to date, and **Retrieve a vault from Google Drive** brings a vault back on another computer. It works through Claude Code on a computer, and it is experimental: keep your own backup as well.

### Fancy mode

Fancy mode starts **off**, with centered small-cap section headings and bordered quotations. Turn it on for quiet italic quotations and justified openings. Both modes open chapters with an ornamental Yinit initial. Images are centred; to place one, add `left`, `right` or `center` before the size, as in `![[image.png|left|300]]`. Links are inked like the ones on this site. **Both modes use the same 1.45 line spacing.**

In Obsidian, go to **Settings → Scriptorium → Fancy mode**. You can also click the **feather icon**, click **Fancy mode: on/off** in the status bar, or use **Scriptorium: Toggle fancy mode** in the command palette. Your choice is remembered for that vault.

The preview switch above compares real screenshots of the two modes.

[Instructions for agents]({{ '/assets/downloads/Scriptorium-Agents.txt' | relative_url }})

### Easy setup

Download the installer for your operating system. It checks for Obsidian and installs it if needed, installs missing EB Garamond and Cormorant Garamond fonts, then creates a new Scriptorium vault with the Lorem Ipsum sample and opens it in Obsidian with its plugins turned on. Close Obsidian before you run it. If Obsidian was open, or is older than version 1.12, choose **Open folder as vault**, select the folder printed by the installer, and click **Trust author and enable plugins**.

- <a href="{{ '/assets/downloads/Scriptorium-Setup.exe' | relative_url }}?v=5bafacc1" download>Windows installer</a> — open `Scriptorium-Setup.exe`, choose the vault folder and click **Install**. To update, choose your existing Scriptorium vault instead: the installer backs up its settings and updates it in place. To add Scriptorium to a vault of your own, choose that vault's folder and click **Set up**. If Windows says it protected your PC, choose **More info**, then **Run anyway**. Prefer a script? Use the <a href="{{ '/assets/downloads/Install-Scriptorium-Windows.cmd' | relative_url }}" download>command-line installer</a>. The installer is built from its [source on GitHub](https://github.com/william590y/scriptorium) (GPL-3.0); see the [releases](https://github.com/william590y/scriptorium/releases) for checksums.
- <a href="{{ '/assets/downloads/Install-Scriptorium-macOS.command' | relative_url }}" download>macOS installer</a> — run `bash ~/Downloads/Install-Scriptorium-macOS.command` in Terminal.
- <a href="{{ '/assets/downloads/Install-Scriptorium-Linux.sh' | relative_url }}" download>Linux installer</a> — run `bash ~/Downloads/Install-Scriptorium-Linux.sh` in Terminal. Requires `curl` and `unzip`. New Linux installs use the official x86-64 or ARM64 AppImage and require AppImage support.

Restart any running Obsidian windows after installation so newly installed fonts are loaded.

### Manual setup

The download includes a Lorem Ipsum sample with a title, subtitle, quotation, and headers. Extract the ZIP and open its folder as a vault in Obsidian. Install **EB Garamond** and **Cormorant Garamond** for the intended typography, then open **Lorem Ipsum** in Reading view. Setup instructions are included. Enable the bundled community plugins to use the Fancy mode switch.
