import {cp, mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root = path.dirname(fileURLToPath(import.meta.url));
const output = path.resolve(process.argv[2] || path.join(root, 'dist'));
if (output === root) throw new Error('Output must be separate from source');
await mkdir(output, {recursive:true});
for (const name of ['index.html','main.mjs','display.mjs','app.webmanifest','runtime.mjs','libc.mjs','jni.mjs','gles.mjs','audio.mjs','save-store.mjs','README.md','package.json','package-lock.json','build-static.mjs','RUNTIME-VALIDATION.md']) {
  await cp(path.join(root,name), path.join(output,name));
}
await cp(path.join(root,'tests'), path.join(output,'tests'), {recursive:true});
await mkdir(path.join(output,'vendor'), {recursive:true});
await rm(path.join(output,'vendor/rebuild'), {recursive:true,force:true});
for (const name of ['unicorn_arm.js','pako-zlib.mjs','LICENSE.unicorn-js','PAKO-LICENSE','README.md','rebuild']) {
  await cp(path.join(root,'vendor',name), path.join(output,'vendor',name), {
    recursive:true, filter: source => !source.endsWith('.tmp')
  });
}
await cp(path.join(root,'game'), path.join(output,'game'), {recursive:true,
  filter: source => source !== path.join(root,'game/assets/ethereal.properties')});
await rm(path.join(output,'game/assets/ethereal.properties'), {force:true});
const manifest = JSON.parse(await readFile(path.join(output,'game/manifest.json'),'utf8'));
for (const item of manifest) {
  const bytes = await readFile(path.join(output,'game',item.url));
  if (bytes.length !== item.size) throw new Error('Asset size mismatch: '+item.url);
}
await writeFile(path.join(output,'BUILD.txt'), 'Original Ninjatown: Trees of Doom! Android 2.5.0\nStatic browser runtime; built '+new Date().toISOString()+'\n');
console.log('Built '+output+' with '+manifest.length+' original game assets');
