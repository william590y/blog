(() => {
  const toggle = document.getElementById('scriptorium-fancy-toggle');
  const image = document.getElementById('scriptorium-preview');
  const link = document.getElementById('scriptorium-preview-link');
  const caption = document.getElementById('scriptorium-preview-caption');
  if (!toggle || !image || !link || !caption) return;
  function updatePreview() {
    const fancy = toggle.checked;
    const source = image.dataset[fancy ? 'fancy' : 'normal'];
    image.src = source;
    link.href = source;
    image.alt = `Scriptorium in Obsidian with Fancy mode ${fancy ? 'on: italic quotations and justified openings' : 'off: centered small-cap headings, bordered quotations and a Yinit drop cap'}, in light mode.`;
    caption.textContent = fancy
      ? 'Fancy mode on — italic quotations and justified openings. Captured in Obsidian, light mode.'
      : 'Fancy mode off — centered small-cap headings, bordered quotations and a Yinit drop cap. Captured in Obsidian, light mode.';
  }
  toggle.addEventListener('change', updatePreview);
  updatePreview();
})();
