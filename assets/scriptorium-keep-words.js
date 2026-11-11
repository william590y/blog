/* Scriptorium: no word is split across the end of a small-capped first line.

   Opening paragraphs (the ones with a drop cap) hyphenate like every other paragraph. The one exception is the
   word at the end of the small-capped first line: if the browser would break it there (by hyphenation, or at the
   hyphen of a compound such as "self-play"), the word is wrapped in a no-break span and moves to the second line
   whole, so no word is half small caps and half lowercase. CSS can't set hyphenation per line, hence the script.
   It re-runs whenever the layout can change: fonts arriving, the initials switching font, a resize. */
(function () {
  var SEL = '.post:not(.no-initial) :is(.post-line + p, .post-line + blockquote + p,' +
            ' :is(h1, h2):not(.post-title) + p, :is(h1, h2):not(.post-title) + blockquote + p)';
  var WORD = /[\p{L}\p{M}\p{N}'’\-‐\u00AD]/u;   // letters, digits, apostrophes, and the hyphens (and soft hyphens) inside words

  function unwrap(p) {
    var spans = p.querySelectorAll('span.sc-keep');
    if (!spans.length) return;
    spans.forEach(function (s) { while (s.firstChild) s.parentNode.insertBefore(s.firstChild, s); s.remove(); });
    p.normalize();
  }

  function textNodes(p) {
    var out = [], w = document.createTreeWalker(p, NodeFilter.SHOW_TEXT), n;
    while ((n = w.nextNode())) if (!n.parentElement.closest('mjx-container, script, style')) out.push(n);
    return out;
  }

  // Wrap the word around the line break (from character a to character b, possibly across text nodes)
  function wrapWord(nodes, a, b) {
    var s = a.slice(), e = b.slice(), m, j;
    for (;;) {   // walk back to the start of the word
      m = s[0]; j = s[1] - 1;
      while (j < 0 && m > 0) { m--; j = nodes[m].data.length - 1; }
      if (j < 0 || !WORD.test(nodes[m].data[j])) break;
      s = [m, j];
    }
    for (;;) {   // and forward to its end
      m = e[0]; j = e[1] + 1;
      while (j >= nodes[m].data.length && m < nodes.length - 1) { m++; j = 0; }
      if (j >= nodes[m].data.length || !WORD.test(nodes[m].data[j])) break;
      e = [m, j];
    }
    for (m = e[0]; m >= s[0]; m--) {   // back to front, so earlier offsets stay valid
      var n = nodes[m], from = m === s[0] ? s[1] : 0, to = m === e[0] ? e[1] + 1 : n.data.length;
      if (to <= from) continue;
      var mid = n.splitText(from); mid.splitText(to - from);
      var span = document.createElement('span'); span.className = 'sc-keep';
      mid.parentNode.insertBefore(span, mid); span.appendChild(mid);
    }
  }

  function keep(p) {
    unwrap(p);
    var nodes = textNodes(p);
    var fs = parseFloat(getComputedStyle(p).fontSize), r = document.createRange(), top0 = null, prev = null;
    for (var k = 0; k < nodes.length; k++) {
      var n = nodes[k];
      for (var i = 0; i < n.data.length; i++) {
        r.setStart(n, i); r.setEnd(n, i + 1);
        var rc = r.getClientRects()[0];
        if (rc && rc.height && rc.height < 2 * fs) {   // skips the floated initial and collapsed white space
          if (top0 === null) top0 = rc.top;
          else if (rc.top > top0 + 0.6 * fs) {         // the first character of the second line
            if (prev && WORD.test(nodes[prev[0]].data[prev[1]]) && WORD.test(n.data[i])) wrapWord(nodes, prev, [k, i]);
            return;
          }
        }
        prev = [k, i];
      }
    }
  }

  window.keepSmallCapsWords = function () { document.querySelectorAll(SEL).forEach(keep); };

  var run = window.keepSmallCapsWords, timer;
  (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(run);
  // the Yinit / Goudy initials switch on with a class on <html> once their font has loaded
  new MutationObserver(run).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  addEventListener('resize', function () { clearTimeout(timer); timer = setTimeout(run, 160); });
})();
