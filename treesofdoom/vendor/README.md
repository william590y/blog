This directory contains a rebuilt ARM-only Unicorn.js 2.1.4 backend.

Upstream sources:

- https://github.com/AlexAltea/unicorn.js at
  `1220477c7fb0f8fe4b500f4bd211de52f6dfe638`
- https://github.com/unicorn-engine/unicorn at
  `8028ec436f2d9376525352dd38ed9ed6b9f6be10`

The JavaScript bundle embeds its WebAssembly binary. The `.js` and `.cjs`
files are identical browser/CommonJS copies, SHA-256:
`f1677557413836c8e5b2071ac269b53e582a36415e31f79531868bd77d98dc4c`.

The emulator caps translation blocks at 32 guest instructions. This fixes a
WebAssembly memory corruption failure when translating long original ARM
blocks; the unmodified 169-instruction regression block now executes correctly.
A live `HEAPU8` getter also exposes mapped memory to the host ABI bridge.
Neither change patches the game executable.

Complete corresponding emulator sources, licenses, local patches, and build
instructions are in `rebuild/unicorn-arm-cap32-source.tar.gz` and `rebuild/`.
The archive contains optional native EABI float helper hooks, disabled in the
default source build. The installed backend above is the plain cap32 build.
The optional hooks passed bit-equivalence tests but made the measured preload
about 17% slower, so they are not included in the installed bundle.

Unicorn.js and these modifications are distributed under GPL-2.0. See
`LICENSE.unicorn-js` and individual source license notices. The emulator source
archive contains no proprietary game executable or assets.
