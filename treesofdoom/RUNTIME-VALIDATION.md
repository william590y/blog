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

## Shop loading timeout regression (2026-09-28)

The browser originally used the runtime's 30-second native-call deadline.
Shop setup is a single long original engine update; the reference desktop run
completed it in 8.35 seconds. To exercise the slower-device timeout path, the
render harness scaled its watchdog clock by 8 after reaching the title menu.
This is a deadline regression test, not an iPhone performance measurement.

With the old deadline, entering the shop reproduced the reported error exactly:
PC `0xe000218`, LR `0x127c410`, `HGString2::internal_setFormattedASCII`, and the
same repeated `strncmp` imports ending with `vsnprintf`. It stopped at 30,761 ms
on the test clock with 4,000,000 counted instructions, below the instruction cap.

The browser now supplies a 120-second native-call deadline. The instruction
limit remains unchanged. Under the same scaled clock, 420 real-rendering frames
completed with no CPU or GL errors: title menu -> shop -> back -> shop -> scroll
-> back. Both shop entries completed, taking about 67.2 and 68.4 seconds on the
test clock. Native states at frames 300/330/360/390/420 were 2/6/2/6/2.

A synthetic infinite ARM branch still trips the instruction guard with the
longer time allowance, and CPU context restoration permits the next valid call.
Budget errors now include elapsed time and counted instructions. Loading may
still be slow; this fix increases the loading allowance rather than speeding
up the emulator. Direct phone validation remains outstanding.


## Fullscreen and runtime optimization (2026-09-28)

The page now includes a Full screen button, a Home Screen web-app manifest,
iOS standalone metadata, installation instructions, safe-area padding, and
aspect-preserving canvas fitting. Rendering remains 320 x 480, so touch
coordinates and original game logic do not change. Native fullscreen is used
when available, with a fitted page view otherwise. Direct iPhone testing is
still outstanding; system status/gesture indicators are controlled by iOS.

Profiling found expensive per-instruction counting and repeated Wasm table
lookups. The new backend adds a C translation-block budget and caches function
pointers with invalidation on every table mutation. No original game bytes
are changed. CPU guard, wall-clock deadline, nested callbacks, and the legacy
instruction-count API remain available. Soft-float hooks remain disabled.

A controlled 1,080-frame Mesa/ANGLE comparison used identical touch events and
a deterministic guest clock (30 Hz); measured host time remained real. All
37 PNG checkpoints were byte-identical. Both runs completed with no CPU or
GL errors. Measured durations in this environment:

| Work | Previous runtime | Optimized candidate | Speed ratio |
| --- | ---: | ---: | ---: |
| Main asset-loading update | 19,446 ms | 11,292 ms | 1.72x |
| Menu updates, median (frames 271-300) | 87.68 ms | 49.13 ms | 1.78x |
| Gameplay updates, median (frames 651-900) | 170.75 ms | 93.05 ms | 1.83x |
| All updates, median | 108.82 ms | 58.05 ms | 1.87x |

These are desktop software-renderer timings, not phone FPS. The measured
candidate stopped before a block that exceeded its remaining batch allowance.
The final helper permits that last block to finish, bounding overshoot to one
cap32 block so unusually small batches cannot stall. CPU regression tests cover
this boundary change, ARM and Thumb loops, nested guest calls, recovery after
a budget failure, legacy fallback, and callback-table slot reuse. Original
SQLite save round trips and the original 169-instruction translation regression
also passed on this final helper.

The test workspace restarted after the completed comparison; the above timing
summary was retained, while its raw logs and PNGs were lost. Final-build
regression checks are recorded separately below.

Final bundle `4480e248...` completed a fresh 1,200-frame real Mesa/ANGLE run
with no CPU or GL errors: title -> shop -> Back -> shop -> scroll -> Back ->
Classic loading -> gameplay, followed by pause/resume. Shop states at frames
300/330/360/390/420 were 2/6/2/6/2; gameplay state was 3 from frame 780 onward.
The untouched game library SHA-256 remains `beebb0f4...`. Results and the
replay harness are retained in `tests/native-render-result.json` and
`tests/native-render.mjs`. The harness requires Node, `gl`, `pngjs`, and a real
GLES-capable display (the test used Xvfb/Mesa). Copy the browser vendor bundle
to `.cjs` for Node as described in the emulator rebuild instructions.
