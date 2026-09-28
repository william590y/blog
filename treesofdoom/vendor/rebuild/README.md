# Corresponding source and rebuild instructions

`unicorn-arm-cap32-source.tar.gz` contains the complete source needed to rebuild
the distributed ARM emulator. Unicorn.js's upstream TCI adaptations are already
applied, and generated symbol headers are included. No game files, SDK binaries,
Git metadata, or generated emulator binaries are included.

Upstream commits:

- https://github.com/AlexAltea/unicorn.js —
  `1220477c7fb0f8fe4b500f4bd211de52f6dfe638`
- https://github.com/unicorn-engine/unicorn —
  `8028ec436f2d9376525352dd38ed9ed6b9f6be10`

The verified build used Emscripten 3.1.74, Python 3.12, CMake 4.4.3, GNU Make,
and pkg-config 1.8.1 on Linux x86-64. Emscripten SDK release hash:
`c2655005234810c7c42e02a18e4696554abe0352`.

Install and activate Emscripten 3.1.74 through
https://github.com/emscripten-core/emsdk. Ensure `cmake`, `make`, `pkg-config`,
and `python` are on PATH. Then:

```sh
source /path/to/emsdk/emsdk_env.sh
tar -xzf unicorn-arm-cap32-source.tar.gz
cd unicorn-arm-cap32-source
NTTOD_SOFTFLOAT=0 python build-cap32.py
```

Output: `dist/unicorn_arm.js`, with WebAssembly embedded. Copy the same bytes to
`.cjs` for Node. This default cap32 build has SHA-256
`f1677557413836c8e5b2071ac269b53e582a36415e31f79531868bd77d98dc4c` with the listed
toolchain; different tool versions may produce different bytes.

`build-cap32.py` uses the already patched sources without Git. The bundled
upstream `build.py` documents compiler/linker options. `cap32.patch` applies
inside the Unicorn subdirectory; `heap-view.patch` and `softfloat.patch` apply
at the Unicorn.js root. The optional float helper source is
`src/nttod-softfloat.c`. To include its native hook exports, build with:

```sh
NTTOD_SOFTFLOAT=1 python build-cap32.py
```

These optional hooks use strict float32 operations (`-fno-fast-math` and
`-ffp-contract=off`), caller-provided helper addresses, and original ARM fallback
for unsupported arithmetic inputs, including subnormal operands/results where
the original ARM implementation has observable arithmetic quirks. They do not
modify guest code. The host
must opt in to register them; compilation alone does not activate hooks.

The optional hook candidate is experimental and is not included in the
distributed JavaScript bundle. It passed 1,455,056 exact output comparisons against
the original ARM helpers: 100,000 deterministic random cases per helper plus
boundary combinations across 14 helpers. See `softfloat-equivalence.json` for
the recorded results. Candidate bundle SHA-256:
`692e355eeabc799e49ca64e761365826c7bf19b940045eff0e193e33c1de79c2`.

Controlled sequential testing found the optional hooks slower: baseline
23.51 seconds total / 20.21 seconds preload, compared with 27.59 / 23.63 seconds
with all 14 hooks (about 17% slower). They therefore remain disabled, and the
installed bundle is the plain cap32 build identified above.

QEMU configuration must succeed. The upstream CMake script does not propagate
configure failures: missing pkg-config or a broken SDK may produce an empty
`unicorn/build/config-host.h` and misleading later compiler errors. A valid
configuration defines `CONFIG_TCG_INTERPRETER`, `CONFIG_POSIX`, and
`CONFIG_INT128`; no manual integer or memory-protection overrides are needed.

Unicorn.js and local changes are GPL-2.0. Original per-file license notices and
the complete upstream LICENSE files are retained in the source archive.
