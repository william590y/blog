# Runtime validation

The release uses the rebuilt ARM-only Unicorn backend with a 32-instruction translation cap. The original game library remains unchanged (SHA256 `beebb0f4de7569198bdb2a9d6a3cb048dbb1737b8453486d8578eb6022ba4209`).

Verified after recovery:

- The exact original 169-instruction Constants block executes successfully. The upstream backend fails while translating this block; limiting instruction execution alone does not fix it.
- Original native function calls, nested native callbacks, and whitelisted inline libc imports pass `smoke-runtime.mjs`.
- The headless native probe completes 120 updates. Its graphics implementation only records calls; actual rendering is validated separately.
- The bundled original SQLite can create and commit a database, export the writable filesystem, restore into a fresh emulator, and read the saved value.

## Rejected optional optimization

Experimental C hooks for 14 standard ARM EABI single-precision compiler helpers passed 1,455,056 exact output comparisons against the original ARM functions. Arithmetic with nonfinite or subnormal operands/results falls back to the original code. Flag-returning comparison helpers are never intercepted. Neither installation nor execution modifies guest instructions.

The hooks remain **disabled by default** because controlled timing showed a regression. With the renderer paused, sequential runs using the same eight native updates gave:

| Backend | Total | Asset-loading update | Later two updates |
| --- | ---: | ---: | ---: |
| Plain cap32 | 23.51 s | 20.21 s | 18.05, 18.06 ms |
| All 14 C hooks | 27.59 s | 23.63 s | 17.13, 17.49 ms |

About 17% slower loading outweighed the small early-frame improvement. These are headless startup measurements, not gameplay or phone FPS. The production vendor files remain plain cap32. The experimental hook source and exact-equivalence harness are retained for review and future research, without enabling the candidate in the application.

Artifacts: `benchmark-controlled-baseline.log`, `benchmark-controlled-softfloat.log`, `softfloat-equivalence.json`, and `softfloat-equivalence.log`. The first long accelerated run stopped producing output after frame 107 with exit status 0 and no final summary; it is not counted as a completed 120-frame test. The subsequent complete eight-frame accelerated runs passed.
