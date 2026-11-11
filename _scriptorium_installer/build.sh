#!/bin/bash
# Builds assets/downloads/Scriptorium-Setup.exe (Windows, .NET Framework 4.8) with Mono's csc on Linux.
# The exe embeds assets/downloads/Scriptorium.zip, so REBUILD IT WHENEVER THE ZIP CHANGES (and re-pin the zip's SHA-256
# in the three Install-Scriptorium-* scripts as before). Mono: conda env /share/ellis/wjl86/envs/mono (conda-forge mono).
set -euo pipefail
cd "$(dirname "$0")"
M=${MONO:-/share/ellis/wjl86/envs/mono}
API=$M/lib/mono/4.8-api
OUT=../assets/downloads/Scriptorium-Setup.exe
"$M/bin/csc" -nologo -noconfig -nostdlib -target:winexe -platform:anycpu -optimize+ -deterministic \
  -r:"$API/mscorlib.dll" -r:"$API/System.dll" -r:"$API/System.Core.dll" -r:"$API/System.Drawing.dll" \
  -r:"$API/System.Windows.Forms.dll" -r:"$API/System.IO.Compression.dll" -r:"$API/System.IO.Compression.FileSystem.dll" \
  -win32icon:scriptorium.ico -win32manifest:app.manifest \
  -resource:../assets/downloads/Scriptorium.zip,Scriptorium.zip \
  -out:"$OUT" ScriptoriumSetup.cs
ls -l "$OUT"
sha256sum "$OUT"
