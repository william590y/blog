const { Plugin, PluginSettingTab, Setting } = require('obsidian');

class ScriptoriumSettings extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    this.containerEl.empty();
    new Setting(this.containerEl)
      .setName('Fancy mode')
      .setDesc('Use the original airy line spacing and quiet italic quotations. Turn off for tighter spacing and bordered quotations.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.fancyMode)
        .onChange(value => this.plugin.setFancyMode(value)));
  }
}

module.exports = class Scriptorium extends Plugin {
  async onload() {
    const saved = await this.loadData();
    this.settings = { fancyMode: typeof saved?.fancyMode === 'boolean' ? saved.fancyMode : false };
    this.ribbon = this.addRibbonIcon('feather', 'Toggle fancy mode', () => {
      void this.setFancyMode(!this.settings.fancyMode);
    });
    this.status = this.addStatusBarItem();
    this.status.addClass('scriptorium-mode-switch');
    this.status.setAttribute('role', 'button');
    this.status.setAttribute('tabindex', '0');
    this.registerDomEvent(this.status, 'click', () => {
      void this.setFancyMode(!this.settings.fancyMode);
    });
    this.registerDomEvent(this.status, 'keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        void this.setFancyMode(!this.settings.fancyMode);
      }
    });
    this.addCommand({
      id: 'toggle-fancy-mode',
      name: 'Toggle fancy mode',
      callback: () => this.setFancyMode(!this.settings.fancyMode)
    });
    this.addSettingTab(new ScriptoriumSettings(this.app, this));
    this.applyMode();
  }

  async setFancyMode(value) {
    this.settings.fancyMode = Boolean(value);
    this.applyMode();
    await this.saveData(this.settings);
  }

  applyMode() {
    const active = this.settings.fancyMode;
    document.body.classList.toggle('scriptorium-fancy', active);
    this.status.setText(`Fancy mode: ${active ? 'on' : 'off'}`);
    for (const element of [this.status, this.ribbon]) {
      element.setAttribute('aria-label', `Toggle fancy mode (currently ${active ? 'on' : 'off'})`);
      element.setAttribute('aria-pressed', String(active));
    }
  }

  onunload() {
    document.body.classList.remove('scriptorium-fancy');
  }
};
