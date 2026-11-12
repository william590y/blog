/* Image focus, after gwern.net: a port of the Scriptorium Obsidian plugin's "Image focus" setting.
   Click (or Enter/Space on) a picture in the page's text and it opens on its own over the dimmed page, fitted to the
   window, with its caption on a paper slip. ←/→ step through the page's pictures ("2 of 5"); the wheel zooms around
   the cursor, drag pans, double-click toggles zoom, + / − / 0 zoom from the keyboard; Esc, a click outside or ×
   closes. On touch screens a tap opens, a swipe steps and two fingers pinch.
   Not focusable: pictures inside links or buttons, outside <main>, smaller than 48 px, and any picture with
   class="no-focus" or data-no-focus (on it or on an ancestor). Styles: assets/scriptorium-site.css. */
(() => {
  'use strict';
  const SKIP = 'a[href], button, label, nav, header, footer, .pagination, .no-focus, [data-no-focus], #scriptorium-preview, .image-focus';
  const TINY = 48;
  const JUNK_ALT = /^(?:description|image|img|picture|pic|photo|figure|fig|alt|untitled|placeholder|screenshot|\d+)$/i;
  const FILE_NAME = /^[\w.\-~%]+\.(?:png|jpe?g|gif|webp|avif|svg|bmp|tiff?)$/i;

  function focusable(img) {
    if (!img || img.tagName !== 'IMG' || !img.closest('main') || img.closest(SKIP) || img.hasAttribute('usemap')) return false;
    const r = img.getBoundingClientRect();
    return r.width >= TINY || r.height >= TINY;   // hidden pictures (0 x 0) and icons are left alone
  }
  const pageImages = () => Array.from(document.querySelectorAll('main img')).filter(focusable);

  /* An alt text worth showing: not empty, not a file name, not a placeholder such as "description" */
  function goodAlt(img) {
    const alt = (img.getAttribute('alt') || '').replace(/\s+/g, ' ').trim();
    const file = (img.getAttribute('src') || '').split(/[?#]/)[0].split('/').pop();
    if (!alt || JUNK_ALT.test(alt) || FILE_NAME.test(alt) || alt === file || alt === file.replace(/\.\w+$/, '')) return '';
    return alt;
  }

  /* The caption: the enclosing figure's figcaption (links and all), else the title, else a real alt text */
  function captionOf(img) {
    const figure = img.closest('figure');
    const figcaption = figure && Array.from(figure.children).find(c => c.tagName === 'FIGCAPTION');
    if (figcaption && figcaption.textContent.trim()) {
      const copy = figcaption.cloneNode(true);
      copy.querySelectorAll('[id]').forEach(x => x.removeAttribute('id'));
      return { nodes: Array.from(copy.childNodes), text: copy.textContent.replace(/\s+/g, ' ').trim() };
    }
    const text = (img.getAttribute('title') || '').trim() || goodAlt(img);
    return { nodes: text ? [document.createTextNode(text)] : [], text };
  }

  /* Marks the page's focusable pictures: the zoom-in cursor, a place in the tab order, a name for screen readers */
  function mark(img) {
    const on = focusable(img), was = img.classList.contains('image-focus-target');
    if (on === was) return;
    img.classList.toggle('image-focus-target', on);
    if (on) {
      if (!img.hasAttribute('tabindex')) { img.tabIndex = 0; img.dataset.focusTab = ''; }
      img.setAttribute('role', 'button');
      img.setAttribute('aria-haspopup', 'dialog');
      const alt = goodAlt(img);
      img.setAttribute('aria-label', alt ? `Enlarge image: ${alt}` : 'Enlarge image');
    } else {
      if ('focusTab' in img.dataset) { img.removeAttribute('tabindex'); delete img.dataset.focusTab; }
      for (const a of ['role', 'aria-haspopup', 'aria-label']) img.removeAttribute(a);
    }
  }
  const markAll = () => document.querySelectorAll('main img').forEach(mark);

  class ImageFocus {
    constructor() {
      this.isOpen = false;
      this.token = 0;
      this.z = 1; this.tx = 0; this.ty = 0;
      this.pointers = new Map();
      this.onResize = () => { if (this.isOpen) this.fit(); };
      this.onKey = e => this.key(e);
    }

    build() {
      if (this.el) return;
      const make = (tag, cls, parent) => { const x = document.createElement(tag); if (cls) x.className = cls; if (parent) parent.appendChild(x); return x; };
      const el = make('div', 'image-focus');
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-modal', 'true');
      el.setAttribute('aria-labelledby', 'image-focus-image');   // named by the picture's caption (its alt text)
      this.stage = make('div', 'image-focus-stage', el);
      this.image = make('img', 'image-focus-image', this.stage);
      this.image.id = 'image-focus-image';
      this.image.draggable = false;
      this.counter = make('div', 'image-focus-counter', el);
      this.counter.setAttribute('aria-hidden', 'true');
      this.status = make('div', 'image-focus-status', el);   // read out on each step: "Image 2 of 5. <caption>"
      this.status.setAttribute('aria-live', 'polite');
      const button = (cls, text, label, fn) => {
        const b = make('button', `image-focus-button ${cls}`, el);
        b.type = 'button';
        b.textContent = text;
        b.title = label;
        b.setAttribute('aria-label', label);
        b.addEventListener('click', e => { e.stopPropagation(); fn(); });
        return b;
      };
      this.prevButton = button('image-focus-prev', '‹', 'Previous image (←)', () => this.step(-1));
      this.nextButton = button('image-focus-next', '›', 'Next image (→)', () => this.step(1));
      this.closeButton = button('image-focus-close', '×', 'Close (Esc)', () => this.close());
      this.caption = make('div', 'image-focus-caption', el);

      el.addEventListener('click', e => {
        if (this.dragged) { this.dragged = false; return; }   // the end of a drag, a pinch or a swipe
        if (e.target === el || e.target === this.stage) this.close();
      });
      el.addEventListener('wheel', e => {
        if (e.target.closest('.image-focus-caption') && this.caption.scrollHeight > this.caption.clientHeight) return;
        e.preventDefault();
        const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
        this.zoomTo(this.z * Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.002)), e.clientX, e.clientY);   // ctrl: a trackpad pinch
      }, { passive: false });
      this.image.addEventListener('dblclick', e => {
        e.preventDefault();
        if (Date.now() - (this.tapZoomed || 0) < 500) return;   // a double tap already did it
        this.toggleZoom(e.clientX, e.clientY);
      });
      el.addEventListener('pointerdown', e => this.down(e));
      el.addEventListener('pointermove', e => this.move(e));
      el.addEventListener('pointerup', e => this.up(e));
      el.addEventListener('pointercancel', e => this.up(e, true));
      el.addEventListener('touchmove', e => { if (!e.target.closest('.image-focus-caption')) e.preventDefault(); }, { passive: false });
      el.addEventListener('gesturestart', e => e.preventDefault());   // Safari: no page zoom under the overlay
      this.el = el;
    }

    open(img) {
      const imgs = pageImages();
      this.items = imgs.length ? imgs : [img];
      const index = Math.max(0, this.items.indexOf(img));
      this.trigger = img;
      this.returnFocus = document.activeElement && document.activeElement !== document.body ? document.activeElement : img;
      this.build();
      document.body.appendChild(this.el);
      this.inerted = Array.from(document.body.children).filter(c => c !== this.el && !c.inert);
      this.inerted.forEach(c => { c.inert = true; });   // the page behind is out of reach (and of the Tab key)
      document.documentElement.classList.add('image-focus-open');
      this.isOpen = true;
      document.addEventListener('keydown', this.onKey, true);
      window.addEventListener('resize', this.onResize);
      this.show(index);
      this.closeButton.focus({ preventScroll: true });
    }

    step(delta) {
      const i = this.index + delta;
      if (this.isOpen && i >= 0 && i < this.items.length) this.show(i);
    }

    show(i) {
      const img = this.items[i], n = this.items.length, cap = captionOf(img);
      this.index = i;
      this.el.classList.toggle('is-single', n < 2);
      this.counter.textContent = n > 1 ? `${i + 1} of ${n}` : '';
      const active = document.activeElement;   // (disabling a focused button drops its focus)
      this.prevButton.disabled = i === 0;
      this.nextButton.disabled = i === n - 1;
      if (active && active.disabled && this.el.contains(active)) {   // an arrow that has run out hands the focus on
        const other = active === this.nextButton ? this.prevButton : this.nextButton;
        (other.disabled ? this.closeButton : other).focus({ preventScroll: true });
      }
      this.caption.replaceChildren(...cap.nodes);
      this.caption.scrollTop = 0;
      this.caption.classList.toggle('is-empty', !cap.nodes.length);
      const label = cap.text || goodAlt(img) || (n > 1 ? `Image ${i + 1} of ${n}` : 'Image');
      this.status.textContent = n > 1 ? `Image ${i + 1} of ${n}. ${cap.text}` : '';
      this.z = 1; this.tx = 0; this.ty = 0;
      const view = this.image, token = ++this.token, url = img.dataset.focusSrc || img.currentSrc || img.src;
      view.alt = label;
      // A picture the page has already loaded is fitted and shown at once (its size is known); any other waits, hidden
      this.natural = !img.dataset.focusSrc && img.complete && img.naturalWidth ? [img.naturalWidth, img.naturalHeight] : null;
      view.classList.toggle('is-loading', !this.natural);
      const ready = () => {
        if (token !== this.token) return;
        if (view.naturalWidth) this.natural = [view.naturalWidth, view.naturalHeight];
        view.classList.remove('is-loading');
        this.fit();
      };
      view.onload = ready;
      view.onerror = ready;
      if (view.getAttribute('src') !== url) view.src = url;
      else if (view.complete) ready();
      if (this.natural) this.fit();
    }

    /* Fits the picture to the window, between the counter and the caption, but never more than twice its own size */
    fit() {
      const view = this.image, el = this.el;
      const [nw, nh] = this.natural || [800, 600];
      const vw = el.clientWidth, vh = el.clientHeight;
      const em = parseFloat(getComputedStyle(el).fontSize) || 18;
      const multi = this.items.length > 1, narrow = vw < 600;   // phones: the arrows sit at the foot, by the slip
      const side = narrow ? 0.5 * em : multi ? 3.6 * em : 1.6 * em, top = 2.8 * em;
      let foot = this.caption.classList.contains('is-empty') ? 0 : this.caption.offsetHeight;
      if (narrow && multi) foot = Math.max(foot, this.nextButton.offsetHeight);
      const bottom = foot ? foot + 1.8 * em : 1.6 * em;
      const aw = Math.max(40, vw - 2 * side), ah = Math.max(40, vh - top - bottom);
      this.scale = Math.min(aw / nw, ah / nh, 2);
      this.w = nw * this.scale;
      this.h = nh * this.scale;
      this.cx = vw / 2;
      this.cy = top + ah / 2;
      Object.assign(view.style, { width: `${this.w}px`, height: `${this.h}px`, left: `${this.cx - this.w / 2}px`, top: `${this.cy - this.h / 2}px` });
      this.clampPan();
      this.apply();
    }

    /* Up to four times the picture's own pixels: at least 2x the fitted view, at most 16x */
    maxZoom() { return Math.max(2, Math.min(16, 4 / (this.scale || 1))); }

    /* Zooms to z, keeping the window's point (x, y) where it is */
    zoomTo(z, x = this.cx, y = this.cy) {
      if (!this.isOpen) return;
      z = Math.min(this.maxZoom(), Math.max(1, z));
      const k = z / this.z;
      this.tx = (x - this.cx) - (x - this.cx - this.tx) * k;
      this.ty = (y - this.cy) - (y - this.cy - this.ty) * k;
      this.z = z;
      if (z <= 1.001) { this.z = 1; this.tx = 0; this.ty = 0; }
      this.clampPan();
      this.apply();
    }

    /* Double click or double tap: in to the picture's own size (2.5x at least, 4x at most), or back out */
    toggleZoom(x, y) {
      if (this.z > 1.001) this.zoomTo(1);
      else this.zoomTo(Math.max(2.5, Math.min(4, 1 / this.scale)), x, y);
    }

    clampPan() {
      const mx = (this.w * this.z) / 2, my = (this.h * this.z) / 2;
      this.tx = Math.min(mx, Math.max(-mx, this.tx || 0));
      this.ty = Math.min(my, Math.max(-my, this.ty || 0));
    }

    apply() {
      this.image.style.transform = `translate(${this.tx}px, ${this.ty}px) scale(${this.z})`;
      this.el.classList.toggle('is-zoomed', this.z > 1.001);
    }

    /* Pointers: one drags a zoomed picture (or swipes to the next one), two pinch */
    down(e) {
      if ((e.pointerType === 'mouse' && e.button !== 0) || e.target.closest('button, .image-focus-caption')) return;
      this.dragged = false;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 2) {
        const [a, b] = Array.from(this.pointers.values());
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, z = this.z;
        this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, z, px: (mx - this.cx - this.tx) / z, py: (my - this.cy - this.ty) / z };
        this.gesture = null;
        this.capture(e);
      } else if (this.pointers.size === 1) {
        this.gesture = { x: e.clientX, y: e.clientY, tx: this.tx, ty: this.ty, moved: false, type: e.pointerType,
          pan: this.z > 1.001 && (e.target === this.image || e.pointerType !== 'mouse') };
        if (this.gesture.pan && e.target === this.image) e.preventDefault();
      }
    }

    capture(e) {
      try { this.el.setPointerCapture(e.pointerId); } catch (err) { /* the pointer is gone already */ }
    }

    move(e) {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      p.x = e.clientX; p.y = e.clientY;
      if (this.pinch && this.pointers.size >= 2) {
        const [a, b] = Array.from(this.pointers.values());
        const z = Math.min(this.maxZoom(), Math.max(1, this.pinch.z * Math.hypot(a.x - b.x, a.y - b.y) / this.pinch.d));
        this.z = z;
        this.tx = (a.x + b.x) / 2 - this.cx - this.pinch.px * z;   // the point between the fingers stays under them
        this.ty = (a.y + b.y) / 2 - this.cy - this.pinch.py * z;
        if (z <= 1.001) { this.z = 1; this.tx = 0; this.ty = 0; }
        this.clampPan();
        this.apply();
        return;
      }
      const g = this.gesture;
      if (!g) return;
      const dx = e.clientX - g.x, dy = e.clientY - g.y;
      if (!g.moved && Math.abs(dx) + Math.abs(dy) > 6) {
        g.moved = true;
        this.capture(e);
        if (g.pan) this.el.classList.add('is-dragging');
      }
      if (g.moved && g.pan) {
        this.tx = g.tx + dx;
        this.ty = g.ty + dy;
        this.clampPan();
        this.apply();
      }
    }

    up(e, cancelled) {
      if (!this.pointers.delete(e.pointerId)) return;
      if (this.pinch) {
        this.dragged = true;
        if (this.pointers.size < 2) this.pinch = null;
        if (this.pointers.size === 1) {   // one finger stays down: it pans from here
          const [p] = Array.from(this.pointers.values());
          this.gesture = { x: p.x, y: p.y, tx: this.tx, ty: this.ty, moved: true, type: e.pointerType, pan: this.z > 1.001 };
        }
        return;
      }
      const g = this.gesture;
      this.gesture = null;
      this.el.classList.remove('is-dragging');
      if (!g || cancelled) return;
      const dx = e.clientX - g.x, dy = e.clientY - g.y;
      if (g.moved) {
        this.dragged = true;
        if (!g.pan && g.type !== 'mouse' && Math.abs(dx) > 40 && Math.abs(dx) > 1.5 * Math.abs(dy)) this.step(dx < 0 ? 1 : -1);
      } else if (g.type !== 'mouse' && e.target === this.image) {   // a double tap zooms
        const now = Date.now(), last = this.lastTap;
        if (last && now - last.t < 350 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 30) {
          this.lastTap = null;
          this.tapZoomed = now;
          this.toggleZoom(e.clientX, e.clientY);
        } else this.lastTap = { t: now, x: e.clientX, y: e.clientY };
      }
    }

    key(e) {
      if (!this.isOpen) return;
      const k = e.key;
      if (k === 'Escape') this.close();
      else if (k === 'ArrowLeft') this.step(-1);
      else if (k === 'ArrowRight') this.step(1);
      else if (k === '+' || k === '=') this.zoomTo(this.z * 1.25);
      else if (k === '-' || k === '_') this.zoomTo(this.z / 1.25);
      else if (k === '0') this.zoomTo(1);
      else if (k === 'Tab') {   // Tab stays among the overlay's buttons (and any links in the caption)
        const stops = Array.from(this.el.querySelectorAll('button, a[href]')).filter(b => !b.disabled && b.getClientRects().length);
        const i = stops.indexOf(document.activeElement);
        if (stops.length) stops[(i + (e.shiftKey ? stops.length - 1 : 1) + stops.length) % stops.length].focus();
      } else if (!['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(k) &&
        !(k === ' ' && !e.target.closest('button, a'))) return;   // other keys (Enter/Space on a button) go through
      e.preventDefault();
      e.stopPropagation();
    }

    close() {
      if (!this.isOpen) return;
      this.isOpen = false;
      this.token++;
      document.removeEventListener('keydown', this.onKey, true);
      window.removeEventListener('resize', this.onResize);
      this.pointers.clear();
      this.pinch = this.gesture = null;
      this.el.classList.remove('is-dragging', 'is-zoomed');
      this.el.remove();
      this.inerted.forEach(c => { c.inert = false; });
      this.inerted = [];
      document.documentElement.classList.remove('image-focus-open');
      const back = this.returnFocus && this.returnFocus.isConnected ? this.returnFocus : this.trigger;
      if (back && back.focus) back.focus({ preventScroll: true });
      this.returnFocus = this.trigger = null;
    }
  }

  const focus = new ImageFocus();
  let downAt = null;
  document.addEventListener('pointerdown', e => { downAt = { x: e.clientX, y: e.clientY }; }, true);
  document.addEventListener('click', e => {
    if (focus.isOpen || e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    if (!focusable(e.target)) return;
    if (downAt && Math.abs(e.clientX - downAt.x) + Math.abs(e.clientY - downAt.y) > 6) return;   // a drag, not a click
    e.preventDefault();
    focus.open(e.target);
  });
  document.addEventListener('keydown', e => {
    if (focus.isOpen || (e.key !== 'Enter' && e.key !== ' ') || e.altKey || e.ctrlKey || e.metaKey) return;
    if (!e.target.classList || !e.target.classList.contains('image-focus-target') || !focusable(e.target)) return;
    e.preventDefault();
    focus.open(e.target);
  });
  // Mark the pictures once the page is laid out, and again as each one loads (its size is known only then)
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', markAll);
  else markAll();
  document.addEventListener('load', e => { if (e.target.tagName === 'IMG' && e.target.closest('main')) mark(e.target); }, true);
  window.addEventListener('load', markAll);
})();
