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
    image.alt = `Scriptorium in Obsidian with Fancy mode ${fancy ? 'on: airy spacing and italic quotations' : 'off: tighter spacing and bordered quotations'}.`;
    caption.textContent = fancy
      ? 'Fancy mode on — original airy spacing and quiet italic quotations. Captured in Obsidian.'
      : 'Fancy mode off — tighter spacing and bordered quotations. Captured in Obsidian.';
  }
  toggle.addEventListener('change', updatePreview);
  updatePreview();
})();
