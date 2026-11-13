// Centred and right-aligned text, as the Scriptorium plugin reads it: a paragraph written
//     ::: center            (or  ::: right ; "dropcap" after it asks for the initial on the aligned text)
//     its lines
//     :::
// is marked .sc-align and .sc-align-center or .sc-align-right, its marker lines are taken out and each of its lines
// becomes a line. An aligned paragraph right under a heading (or under another such paragraph) is marked .sc-opens:
// the stylesheet gives the chapter's initial to the first ordinary paragraph after it. See assets/scriptorium-site.css.
(function () {
  var OPEN = /^\s*:{3,}[ \t]*\{?[ \t]*\.?(center|centre|centered|centred|right)(?![\w-])([^{}\n]*)\}?[ \t]*:*[ \t]*(?:\n|$)/i;
  var CLOSE = /\n[ \t]*:{3,}[ \t]*$/;
  function mark(p) {
    var first = p.firstChild, last = p.lastChild;
    if (!first || first.nodeType !== 3 || !last || last.nodeType !== 3) return false;
    var open = OPEN.exec(first.data);
    if (!open) return false;
    var tail = last.data.replace(/\s+$/, '');
    if (!CLOSE.test(first === last ? tail.slice(open[0].length - 1) : tail)) return false;
    last.data = tail.replace(CLOSE, '');
    first.data = first.data.slice(open[0].length);
    // every line of the note is a line of the page
    var walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT), nodes = [], n;
    while ((n = walker.nextNode())) nodes.push(n);
    nodes.forEach(function (node) {
      var parts = node.data.split('\n');
      if (parts.length < 2) return;
      var frag = document.createDocumentFragment();
      parts.forEach(function (part, i) {
        if (i) frag.appendChild(document.createElement('br'));
        if (part) frag.appendChild(document.createTextNode(part));
      });
      node.parentNode.replaceChild(frag, node);
    });
    p.classList.add('sc-align', /^r/i.test(open[1]) ? 'sc-align-right' : 'sc-align-center');
    if (/(^|[\s.])drop-?cap(?![\w-])/i.test(open[2])) p.classList.add('sc-align-dropcap');
    return true;
  }
  function run() {
    var posts = document.querySelectorAll('.post');
    for (var i = 0; i < posts.length; i++) {
      var ps = posts[i].querySelectorAll('p');
      for (var j = 0; j < ps.length; j++) if (ps[j].textContent.indexOf(':::') >= 0) mark(ps[j]);
      var aligned = posts[i].querySelectorAll('p.sc-align:not(.sc-align-dropcap)');
      for (var k = 0; k < aligned.length; k++) {
        var prev = aligned[k].previousElementSibling;
        if (prev && (prev.classList.contains('post-line') || prev.classList.contains('sc-opens') || (/^H[12]$/.test(prev.tagName) && !prev.classList.contains('post-title')))) aligned[k].classList.add('sc-opens');
      }
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
})();
