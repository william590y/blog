This directory contains a rebuilt ARM-only Unicorn.js 2.1.4 backend.

Upstream sources:

- https://github.com/AlexAltea/unicorn.js at
  `1220477c7fb0f8fe4b500f4bd211de52f6dfe638`
- https://github.com/unicorn-engine/unicorn at
  `8028ec436f2d9376525352dd38ed9ed6b9f6be10`

The JavaScript bundle embeds its WebAssembly binary. The `.js` and `.cjs`
files are identical browser/CommonJS copies, SHA-256:
`4480e24814966a39e052e711601c3d33e245aeaf047bb4de29af210f5720b4c4`.

The current performance build adds a native translation-block budget and a
coherent JavaScript cache of WebAssembly function pointers. The instruction
guard and wall-clock deadline remain active. Apply `block-budget.patch`,
`nttod-block-budget.c`, and `cache-wasm-table.py` to the baseline archive as
described in `rebuild/README.md` to reproduce the current bundle.
For Node, copy `unicorn_arm.js` to `unicorn_arm.cjs` without changing its bytes.

The emulator caps translation blocks at 32 guest instructions. This fixes a
WebAssembly memory corruption failure when translating long original ARM
blocks; the unmodified 169-instruction regression block now executes correctly.
A live `HEAPU8` getter also exposes mapped memory to the host ABI bridge.
Neither change patches the game executable.

Complete corresponding emulator sources, licenses, local patches, and build
instructions are in `rebuild/unicorn-arm-cap32-source.tar.gz` and `rebuild/`.
The archive contains optional native EABI float helper hooks, disabled in the
default source build. The installed backend above has no float-helper hooks.
The optional hooks passed bit-equivalence tests but made the measured preload
about 17% slower, so they are not included in the installed bundle.

Unicorn.js and these modifications are distributed under GPL-2.0. See
`LICENSE.unicorn-js` and individual source license notices. The emulator source
archive contains no proprietary game executable or assets.
