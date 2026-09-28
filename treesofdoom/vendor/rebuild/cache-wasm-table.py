"""GPL-2.0. Cache Wasm table reads and synchronize every add/remove mutation.

Usage: python cache-wasm-table.py input.js output.js (same path is supported).
Refuse an unfamiliar Emscripten bundle instead of silently applying half a patch.
"""
from pathlib import Path
import sys
src=Path(sys.argv[1]);dst=Path(sys.argv[2]);text=src.read_text()
pairs=[('var getWasmTableEntry=funcPtr=>wasmTable.get(funcPtr);','var wasmTableMirror=[];var getWasmTableEntry=funcPtr=>wasmTableMirror[funcPtr]===undefined?(wasmTableMirror[funcPtr]=wasmTable.get(funcPtr)):wasmTableMirror[funcPtr];'),('var setWasmTableEntry=(idx,func)=>wasmTable.set(idx,func);','var setWasmTableEntry=(idx,func)=>{wasmTable.set(idx,func);wasmTableMirror[idx]=func};')]
for old,new in pairs:
 if text.count(old)!=1:raise SystemExit('Expected exactly one matching table accessor: '+old)
 text=text.replace(old,new)
dst.write_text(text)
