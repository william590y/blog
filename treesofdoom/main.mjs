import {ArmRuntime} from './runtime.mjs';
import {readSaves, writeSaves} from './save-store.mjs';

const canvas = document.querySelector('#screen');
const button = document.querySelector('#play');
const status = document.querySelector('#status');
const diagnostics = document.querySelector('#diagnostics');
const debug = new URLSearchParams(location.search).has('debug');
diagnostics.hidden = !debug;
function log(...parts) {
  const line = parts.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ');
  console.log(line);
  if (debug) { diagnostics.textContent += '\n' + line; diagnostics.scrollTop = diagnostics.scrollHeight; }
}
function stage(message) { status.textContent = message; if (message) log(message); }
let runtime, game, libc, graphics, audio, audioContext;
let active = false, paused = false, failed = false, saveQueue = Promise.resolve();
function queueSave(files) {
  saveQueue = saveQueue.then(() => writeSaves(files)).catch(error => {
    log('Save failed', error.message);
    stage('Your browser could not save progress. Keep this page open to continue this session.');
  });
}
function failure(message, error) {
  active = false; failed = true;
  stage(message + ': ' + error.message); log(error.stack || error.message);
  if (runtime) log('Recent native calls', runtime.lastImports);
  button.hidden = false; button.disabled = false; button.textContent = 'Reload game';
}
canvas.addEventListener('webglcontextcreationerror', event => log('WebGL', event.statusMessage));
canvas.addEventListener('webglcontextlost', event => {
  event.preventDefault();
  failure('Graphics interrupted', new Error('Reload the game to continue'));
});
button.addEventListener('click', async () => {
  if (failed) { location.reload(); return; }
  button.disabled = true;
  try {
    const options = {alpha:false, antialias:false, stencil:true, preserveDrawingBuffer:true};
    const gl = canvas.getContext('webgl', options) || canvas.getContext('experimental-webgl', options);
    if (!gl) throw new Error('WebGL graphics are unavailable in this browser');
    const Audio = window.AudioContext || window.webkitAudioContext;
    audioContext = Audio ? new Audio() : null;
    if (audioContext) await audioContext.resume();
    const [{installLibc}, {installJNI}, {installGLES}, {installAudio}] = await Promise.all([
      import('./libc.mjs'), import('./jni.mjs'), import('./gles.mjs'), import('./audio.mjs')
    ]);
    let saves;
    try { saves = await readSaves(); }
    catch (error) { saves = new Map(); log('Saved progress unavailable', error.message); }
    stage('Loading the original game…');
    const fs = new Map();
    const manifestResponse = await fetch('./game/manifest.json');
    if (!manifestResponse.ok) throw new Error('Asset manifest unavailable');
    const manifest = await manifestResponse.json();
    let loaded = 0;
    const [native] = await Promise.all([
      fetch('./game/libnttod.so').then(async response => {
        if (!response.ok) throw new Error('Game program unavailable');
        return new Uint8Array(await response.arrayBuffer());
      }),
      ...manifest.map(async item => {
        const response = await fetch('./game/' + item.url);
        if (!response.ok) throw new Error('Missing game asset: ' + item.url);
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.length !== item.size) throw new Error('Incomplete game asset: ' + item.url);
        fs.set(item.path, bytes); loaded++;
        status.textContent = `Loading the original game… ${loaded}/${manifest.length}`;
      })
    ]);
    runtime = await ArmRuntime.create({onLog:log});
    libc = installLibc(runtime, {fs, saves, onSave:queueSave, onLog:log});
    // MemoryFS owns copies; release download buffers to reduce phone memory use.
    fs.clear(); saves.clear();
    graphics = installGLES(runtime, gl, {onDiagnostic:log});
    audio = installAudio(runtime, {fs:libc.fs, audioContext, onLog:log});
    game = installJNI(runtime, {fs:libc.fs, onLog:log, onHideSplash:() => stage('')});
    runtime.loadElf(native);
    stage('Starting the original engine…');
    runtime.constructors();
    game.startup({width:320, height:480});
    active = true; button.hidden = true;
    stage('Loading game assets…');
    let frames = 0, last = performance.now();
    function frame() {
      if (!active) return;
      if (paused) { requestAnimationFrame(frame); return; }
      try {
        game.update(); graphics.frame(); libc.fs.flush(); frames++;
        const now = performance.now();
        if (debug && now - last > 3000) {
          log('Frames', frames, 'elapsed ms', Math.round(now-last), 'native', runtime.stats);
          frames = 0; last = now;
        }
        requestAnimationFrame(frame);
      } catch (error) { failure('The game stopped', error); }
    }
    requestAnimationFrame(frame);
  } catch (error) { failure('Unable to start the game', error); }
});
for (const [type, action] of [['pointerdown',0], ['pointerup',1], ['pointermove',2], ['pointercancel',1]]) {
  canvas.addEventListener(type, event => {
    if (!active || paused || (type === 'pointermove' && event.buttons === 0)) return;
    event.preventDefault();
    if (type === 'pointerdown') {
      canvas.setPointerCapture(event.pointerId);
      if (audioContext?.state !== 'running') audio?.unlock().catch(error => log('Audio resume', error.message));
    }
    const rect = canvas.getBoundingClientRect();
    try {
      game.touch(action, (event.clientX-rect.left)*canvas.width/rect.width,
        (event.clientY-rect.top)*canvas.height/rect.height, event.pointerId);
    } catch (error) { failure('Input failed', error); }
  });
}
document.addEventListener('visibilitychange', () => {
  if (!active) return;
  try {
    if (document.hidden) {
      paused = true; game.pause(); libc.fs.flush();
      audioContext?.suspend().catch(error => log('Audio pause', error.message));
    } else {
      game.resume(); paused = false;
      audio?.unlock().catch(error => log('Audio resume', error.message));
    }
  } catch (error) { failure('Unable to resume the game', error); }
});
window.addEventListener('pagehide', () => { if (libc) libc.fs.flush(); });
