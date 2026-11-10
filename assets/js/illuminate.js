/* Illuminated initials for williamliaw.com (see assets/css/manuscript.css).
   - The first letter of a post's opening paragraph becomes a gilded initial: an uncial capital in burnished gold
     on a coloured, diapered ground with white filigree, framed in gold. Colours and flourishes vary by letter.
   - Post titles on the index get a small gilded initial.
   - Paragraphs that open a section (after an h2/h3) get a two-line coloured versal, alternating red and blue.
   - A paragraph that is only an asterism (⁂, * * *, ***) becomes a red fleuron.
   The letter stays in the text for screen readers and copy-paste; the drawing is aria-hidden. */
(function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  var GROUNDS = [
    { field: '#24418f', alt: '#6c2440', vine: '#f3ead6' },   // lapis, murrey filigree
    { field: '#a3271d', alt: '#24418f', vine: '#f6eedd' },   // vermilion
    { field: '#2f7055', alt: '#a3271d', vine: '#f1ead4' },   // verdigris
    { field: '#6c2440', alt: '#2f7055', vine: '#f4e9d8' }    // murrey
  ];
  var uid = 0;

  function hash(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) { return function () { seed = (seed + 0x6D2B79F5) | 0; var t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  // one corner tendril: a spiral curl with a leaf, drawn in the 100x100 box and rotated into a corner
  function tendril(rot, flip, r, color) {
    var s = 0.85 + 0.3 * r();
    var a = 8 + 6 * r();
    var d = 'M 9 9 C ' + (18 * s) + ' ' + (6 * s) + ', ' + (27 * s) + ' ' + (14 * s) + ', ' + (24 * s) + ' ' + (22 * s) +
            ' C ' + (21 * s) + ' ' + (29 * s) + ', ' + (13 * s) + ' ' + (27 * s) + ', ' + (15 * s) + ' ' + (21 * s) +
            ' C ' + (16.5 * s) + ' ' + (17 * s) + ', ' + (20 * s) + ' ' + (18 * s) + ', ' + (19.5 * s) + ' ' + (20.5 * s);
    var leaf = '<ellipse cx="' + (26 * s + 2) + '" cy="' + (10 * s) + '" rx="' + (a * 0.42) + '" ry="' + (a * 0.18) +
               '" transform="rotate(' + (20 + 30 * r()) + ' ' + (26 * s + 2) + ' ' + (10 * s) + ')" fill="' + color + '" opacity="0.9"/>';
    var dots = '<circle cx="' + (11 * s + 3) + '" cy="' + (29 * s) + '" r="1.1" fill="' + color + '"/>' +
               '<circle cx="' + (30 * s) + '" cy="' + (27 * s) + '" r="0.9" fill="' + color + '"/>';
    var tf = 'rotate(' + rot + ' 50 50)' + (flip ? ' translate(100 0) scale(-1 1)' : '');
    return '<g transform="' + tf + '"><path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="1.25" stroke-linecap="round" opacity="0.92"/>' + leaf + dots + '</g>';
  }

  function initialSVG(letter, opts) {
    opts = opts || {};
    var h = hash(letter + (opts.salt || ''));
    var r = rng(h);
    var g = GROUNDS[h % GROUNDS.length];
    var id = 'il' + (++uid);
    var mini = !!opts.mini;
    var parted = !mini && (h >> 3) % 3 === 0;          // some initials sit on a ground parted in two colours
    var svg = '';
    svg += '<svg xmlns="' + NS + '" viewBox="0 0 100 100" aria-hidden="true" focusable="false">';
    svg += '<defs>' +
      '<linearGradient id="' + id + 'g" x1="0" y1="0" x2="1" y2="1">' +
        '<stop offset="0" stop-color="#fff4bf"/><stop offset=".28" stop-color="#e9c75d"/><stop offset=".55" stop-color="#b68d2e"/>' +
        '<stop offset=".78" stop-color="#f3dc8c"/><stop offset="1" stop-color="#8a6a1d"/></linearGradient>' +
      '<linearGradient id="' + id + 'f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e6c35a"/><stop offset="1" stop-color="#9b7623"/></linearGradient>' +
      '<pattern id="' + id + 'd" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45 50 50)">' +
        '<path d="M0 5 H10 M5 0 V10" stroke="#f6e5a0" stroke-width=".45" opacity=".38"/>' +
        '<circle cx="5" cy="5" r=".9" fill="#fff" opacity=".55"/></pattern>' +
      '<filter id="' + id + 's" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx=".9" dy="1.1" stdDeviation=".7" flood-color="#000" flood-opacity=".45"/></filter>' +
      '</defs>';
    // gold frame and ground
    svg += '<rect x=".75" y=".75" width="98.5" height="98.5" rx="' + (mini ? 6 : 2.5) + '" fill="url(#' + id + 'f)" stroke="#6b5014" stroke-width="1"/>';
    svg += '<rect x="5" y="5" width="90" height="90" rx="' + (mini ? 4 : 1.5) + '" fill="' + g.field + '"/>';
    if (parted) svg += '<path d="M5 95 L95 5 L95 95 Z" fill="' + g.alt + '"/>';
    svg += '<rect x="5" y="5" width="90" height="90" fill="url(#' + id + 'd)"/>';
    if (!mini) {
      svg += tendril(0, false, r, g.vine) + tendril(90, false, r, g.vine) + tendril(180, false, r, g.vine) + tendril(270, false, r, g.vine);
      svg += '<rect x="7.5" y="7.5" width="85" height="85" fill="none" stroke="#f6e5a0" stroke-width=".7" opacity=".7"/>';
      // gold bezants on the frame
      [[5, 5], [95, 5], [5, 95], [95, 95], [50, 3], [50, 97], [3, 50], [97, 50]].forEach(function (p) {
        svg += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="2.3" fill="url(#' + id + 'g)" stroke="#6b5014" stroke-width=".5"/>';
      });
    }
    if (!mini) {
      // a vine-and-ivy tail hanging from the initial into the left margin (a "bar border"); hidden on narrow screens
      var tc = g.alt;
      svg += '<g class="tail">' +
        '<path d="M4 97 C -6 102, -22 108, -22 126 S -12 158, -24 180 S -34 210, -22 232" fill="none" stroke="' + tc + '" stroke-width="2.2" stroke-linecap="round"/>' +
        '<path d="M4 97 C -6 102, -22 108, -22 126 S -12 158, -24 180 S -34 210, -22 232" fill="none" stroke="#e9c75d" stroke-width=".7" stroke-linecap="round" opacity=".9"/>' +
        ['-30 118 -150', '-15 152 25', '-34 198 -150'].map(function (q) {
          var v = q.split(' ');
          return '<path d="M0 0 c6-7 15-6 16 0 c-5 5-11 6-16 0z" transform="translate(' + v[0] + ' ' + v[1] + ') rotate(' + v[2] + ')" fill="#2f7055" stroke="#1d4a37" stroke-width=".5"/>';
        }).join('') +
        '<circle cx="-22" cy="128" r="2.4" fill="url(#' + id + 'g)" stroke="#6b5014" stroke-width=".5"/>' +
        '<circle cx="-25" cy="182" r="2.4" fill="url(#' + id + 'g)" stroke="#6b5014" stroke-width=".5"/>' +
        '<g transform="translate(-22 238)"><circle r="3.4" fill="url(#' + id + 'g)" stroke="#6b5014" stroke-width=".6"/>' +
        '<circle cx="-4.5" cy="4" r="2.2" fill="' + tc + '"/><circle cx="4.5" cy="4" r="2.2" fill="' + tc + '"/><circle cy="6.5" r="2.2" fill="' + tc + '"/></g>' +
        '</g>';
    }
    // the letter, gilded
    var fs = mini ? 80 : 72;
    svg += '<text x="50" y="' + (mini ? 53 : 54) + '" text-anchor="middle" dominant-baseline="central" ' +
           'font-family="Uncial Antiqua, Cormorant Garamond, serif" font-size="' + fs + '" ' +
           'fill="url(#' + id + 'g)" stroke="#4a3410" stroke-width="' + (mini ? 1.6 : 1.1) + '" paint-order="stroke" ' +
           'filter="url(#' + id + 's)">' + letter + '</text>';
    svg += '</svg>';
    return svg;
  }

  // split the first alphabetic character off the first text node of el; returns {lead, letter, node} or null
  function firstLetter(el) {
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    var node;
    while ((node = walker.nextNode())) {
      if (node.parentNode.closest && node.parentNode.closest('.MathJax, script, code, .illum, .mini-illum')) return null;
      var t = node.nodeValue;
      if (!t.trim()) continue;
      var m = t.match(/^(\s*["“‘'(\[]*)(\p{L})/u);
      if (!m) return null;
      return { node: node, lead: m[1], letter: m[2], cut: m[0].length };
    }
    return null;
  }

  function illuminate(p, mini, holderClass) {
    var f = firstLetter(p);
    if (!f) return false;
    var holder = document.createElement('span');
    holder.className = holderClass;
    holder.setAttribute('aria-hidden', 'true');
    holder.innerHTML = initialSVG(f.letter.toUpperCase() === f.letter ? f.letter : f.letter.toUpperCase(), { mini: mini });
    var sr = document.createElement('span');
    sr.className = 'sr-letter';
    sr.textContent = f.lead.trim() + f.letter;
    var rest = f.node.nodeValue.slice(f.cut);
    f.node.nodeValue = rest;
    f.node.parentNode.insertBefore(holder, f.node);
    f.node.parentNode.insertBefore(sr, f.node);
    return true;
  }

  function isAsterism(p) { var t = (p.textContent || '').replace(/\s+/g, ''); return /^(⁂|\*{3}|∗{3}|❦|☙|❧)$/.test(t); }

  function run() {
    var post = document.querySelector('.post');
    if (post) {
      var paras = Array.prototype.filter.call(post.querySelectorAll('p'), function (p) {
        return !p.closest('blockquote, .post-info, li, figure, table, footer');
      });
      // the opening: the first paragraph of the body that is a real sentence (not an asterism or a stub)
      var opening = null;
      for (var i = 0; !opening && i < paras.length && i < 3; i++) {
        if (!isAsterism(paras[i]) && (paras[i].textContent || '').trim().length >= 40 && firstLetter(paras[i])) opening = paras[i];
      }
      if (opening) {
        opening.classList.add('opening');
        if (illuminate(opening, false, 'illum')) opening.classList.add('illuminated');
      }
      // versals and fleurons
      var colour = 0;
      paras.forEach(function (p) {
        if (isAsterism(p)) { p.classList.add('fleuron'); p.textContent = '❦'; p.setAttribute('role', 'separator'); return; }
        if (p === opening) return;
        var prev = p.previousElementSibling;
        if (prev && /^H[23]$/.test(prev.tagName) && (p.textContent || '').trim().length >= 60 && firstLetter(p)) {
          p.classList.add('versal', colour % 2 ? 'versal-blue' : 'versal-red');
          colour++;
        }
      });
    }
    // small gilded initials on the index
    Array.prototype.forEach.call(document.querySelectorAll('.catalogue-title'), function (h) {
      if (!h.querySelector('.mini-illum')) illuminate(h, true, 'mini-illum');
    });
    // colophon year in Roman numerals
    var y = document.querySelector('footer .anno');
    if (y) y.textContent = roman(new Date().getFullYear());
  }

  function roman(n) {
    var map = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
    var s = '';
    map.forEach(function (m) { while (n >= m[0]) { s += m[1]; n -= m[0]; } });
    return s;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
})();
