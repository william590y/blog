// Presentation only: the game keeps its original 320 x 480 coordinates.
const player = document.querySelector('#player');
const stage = document.querySelector('#stage');
const canvas = document.querySelector('#screen');
const fullscreen = document.querySelector('#fullscreen');
const install = document.querySelector('#install');
const help = document.querySelector('#install-help');
const standalone = matchMedia('(display-mode: standalone)');
const fullDisplay = matchMedia('(display-mode: fullscreen)');
const isInstalled = () => navigator.standalone === true || standalone.matches || fullDisplay.matches;
const fullscreenElement = () => document.fullscreenElement || document.webkitFullscreenElement;
let immersive = false;
let requestedNative = false;

function fit() {
  const width = Math.min(stage.clientWidth, stage.clientHeight * 2 / 3);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${width * 3 / 2}px`;
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
fullscreen.addEventListener('click', async () => {
  if (immersive) {
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (fullscreenElement() && exit) {
      try { await exit.call(document); } catch { /* Page mode can still exit. */ }
    }
    requestedNative = false;
    setImmersive(false);
    return;
  }
  setImmersive(true);
  const request = player.requestFullscreen || player.webkitRequestFullscreen;
  if (request) {
    try { requestedNative = true; await request.call(player); }
    catch { requestedNative = false; }
  }
  // iPhone can use the page-sized view immediately; Home Screen removes toolbars.
  if (!fullscreenElement() && !isInstalled()) help.showModal();
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
install.addEventListener('click', () => help.showModal());
new ResizeObserver(fit).observe(stage);
window.visualViewport?.addEventListener('resize', fit);
standalone.addEventListener('change', () => setImmersive(isInstalled()));
setImmersive(isInstalled());
