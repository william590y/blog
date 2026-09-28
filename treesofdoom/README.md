# Trees of Doom — original-game browser runtime

This project executes the unmodified ARM game library from Ninjatown: Trees of
Doom! Android 2.5.0. Unicorn WebAssembly emulates its CPU instructions. Browser
adapters supply Android/JNI, libc, GLES2/WebGL and FMOD/Web Audio services.
The gameplay and artwork come from the original game, not a recreation.

## Verification status

The unmodified original game runs through the title screen, menus and Classic
level. Real Mesa/ANGLE GLES2 tests verified jumping, climbing, coin collection,
branch grabbing, drag-to-aim/release-to-launch and pause/resume. The character
reached height 50 with 10 coins through the original tutorial. All observed
rendering checks reported no GL errors.

The original loader builds 250 chunks across successive updates. Loading is
slow, and the desktop software-rendering test ran at roughly7–10 frames/second
during gameplay. Direct iPhone Safari performance has not been verified.
The cloud test browser disables WebGL, so these gameplay checks used actual
GLES2 through Mesa/ANGLE, not that browser or a graphics-call recorder.

Native SQLite created, committed, exported, restored in a fresh emulator and
read the saved value correctly. All five original Ogg music tracks decoded
through browser Web Audio. Browser storage retains progress through IndexedDB.

The release uses the validated cap32 emulator. Experimental native math hooks
matched 1,455,056 comparisons against original ARM outputs but slowed asset
loading 17%, so they are disabled. The original game library is unchanged.


## Files

- `runtime.mjs`: ARM ELF loading, memory, host imports and execution.
- `libc.mjs`: C library, virtual filesystem, SQLite support and zlib.
- `jni.mjs`: original native lifecycle, touch input and Android host services.
- `gles.mjs`: original GLES2 calls translated to WebGL1.
- `audio.mjs`: original FMOD calls adapted to Web Audio.
- `main.mjs`, `index.html`: browser entry point and touch/lifecycle handling.
- `save-store.mjs`: IndexedDB persistence for writable game files.
- `game/`: original native library and original extracted assets.
- `vendor/`: emulator and zlib, licenses and corresponding emulator source.
- `node-render.mjs`: real headless GLES2 test harness, not a browser substitute.
- `node-probe.mjs`: graphics-call recording diagnostic, not rendering proof.

No external game server is used. Optional advertising, purchases, social
services and online leaderboards are unavailable. Native service adapters
must deliver their offline/error callbacks without modifying game logic.

The first download includes approximately 44 MB of original game content.
Progress is saved to this site's IndexedDB when browser storage is available;
clearing site data deletes local progress. Browser audio starts with a user
gesture. Graphics requires WebGL1.

## Development and static deployment

`npm ci` and `npm run dev` start the local development server. Append `?debug`
to see native diagnostics. `npm run build -- /absolute/output/directory`
copies a self-contained static deployment, including runtime source, original
assets, dependency licenses and the corresponding emulator source archive.

The destination is `treesofdoom/` in `william590y/blog`, branch `gh-pages`.
Relative URLs support the `/treesofdoom/` path without changing the blog's
Jekyll configuration. Actual gameplay validation is required before publishing.

## Provenance

Input APK: `Ninjatown-Trees-of-Doom-2.5.0.apk`, 43,909,929 bytes.
SHA-256: `8cb94c4ab9f0caa3a08056b1edd4a9ccc1b21eca7501a367317f4a178850682a`.

Original native library: `lib/armeabi/libnttod.so`, 4,605,644 bytes.
SHA-256: `beebb0f4de7569198bdb2a9d6a3cb048dbb1737b8453486d8578eb6022ba4209`.

Every included game asset and the native library were compared byte-for-byte
against that APK after recovery. The optional legacy Ethereal online-service
configuration is excluded from the browser distribution. Original game content retains its original
ownership. The emulator's GPL-2.0 license and zlib dependency's license are
included separately; neither licenses the original game's content.
