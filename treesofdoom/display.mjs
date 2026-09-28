const player = document.querySelector('#player');
const stage = document.querySelector('#stage');
const canvas = document.querySelector('#screen');
const fullscreen = document.querySelector('#fullscreen');
const install = document.querySelector('#install');
const menu = document.querySelector('#menu');
const help = document.querySelector('#install-help');
const standalone = matchMedia('(display-mode: standalone)');
const fullDisplay = matchMedia('(display-mode: fullscreen)');
const isInstalled = () => navigator.standalone === true || standalone.matches || fullDisplay.matches;
const fullscreenElement = () => document.fullscreenElement || document.webkitFullscreenElement;
let immersive = true, requestedNative = false;
let dimensions = {width:320,height:480};

function fit() {
  // Keep the original asset resolution while letting the native engine lay out
  // its scene at the actual portrait aspect ratio (including tall iPhones).
  const width = Math.min(stage.clientWidth, stage.clientHeight * 2 / 3);
  const height = stage.clientHeight;
  if (width <= 0 || height <= 0) return;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  dimensions = {width:320,height:Math.max(480,Math.round(height * 320 / width))};
}
export function gameDimensions() { return dimensions; }
export function setPlaying(enabled) {
  player.classList.toggle('playing', enabled);
  player.classList.remove('menu-open');
  menu.setAttribute('aria-expanded','false');
}
function setImmersive(enabled) {
  immersive = enabled;
  player.classList.toggle('immersive', enabled);
  document.documentElement.classList.toggle('immersive', enabled);
  fullscreen.textContent = enabled ? 'Exit full screen' : 'Full screen';
  fullscreen.setAttribute('aria-pressed', String(enabled));
  install.hidden = isInstalled();
  requestAnimationFrame(fit);
}
async function requestNativeFullscreen() {
  if (!immersive || fullscreenElement() || isInstalled()) return;
  const request = player.requestFullscreen || player.webkitRequestFullscreen;
  if (request) {
    try { requestedNative = true; await request.call(player); }
    catch { requestedNative = false; }
  }
}
// Native fullscreen requires a gesture. The fitted view is already active at
// page load; Play requests native fullscreen where the browser supports it.
document.querySelector('#play').addEventListener('click', requestNativeFullscreen);
fullscreen.addEventListener('click', async () => {
  if (immersive) {
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (fullscreenElement() && exit) { try { await exit.call(document); } catch {} }
    requestedNative = false;
    setImmersive(false);
  } else {
    setImmersive(true);
    await requestNativeFullscreen();
  }
});
function fullscreenChanged() {
  if (fullscreenElement()) setImmersive(true);
  else if (requestedNative) { requestedNative = false; setImmersive(false); }
}
document.addEventListener('fullscreenchange', fullscreenChanged);
document.addEventListener('webkitfullscreenchange', fullscreenChanged);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !help.open && !fullscreenElement()) setImmersive(false);
});
menu.addEventListener('click', () => {
  const open = player.classList.toggle('menu-open');
  menu.setAttribute('aria-expanded',String(open));
  menu.textContent = open ? 'Close' : 'Menu';
});
install.addEventListener('click', () => help.showModal());
// Selection/callouts are blocked only on the game surface. Buttons and the
// help dialog retain their normal click, keyboard, and accessibility behavior.
for (const type of ['selectstart','contextmenu','dragstart']) {
  player.addEventListener(type, event => event.preventDefault());
}
for (const type of ['touchstart','touchmove']) {
  canvas.addEventListener(type, event => event.preventDefault(), {passive:false});
}
canvas.addEventListener('pointerdown', () => window.getSelection()?.removeAllRanges());
new ResizeObserver(fit).observe(stage);
window.visualViewport?.addEventListener('resize', fit);
standalone.addEventListener('change', () => { install.hidden = isInstalled(); fit(); });
setImmersive(true);
