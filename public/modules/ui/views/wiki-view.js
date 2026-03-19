/**
 * Wiki View
 * Placeholder implementation for Wiki UI
 */

export class WikiView {
  constructor({ service, eventBus, container }) {
    this.service = service;
    this.eventBus = eventBus;
    this._container = container;
  }

  mount(container) {
    this._container = container;
    this.render();
  }

  render() {
    if (this._container) {
      this._container.innerHTML = '<div class="wiki-placeholder">Wiki feature coming soon...</div>';
    }
  }

  unmount() {
    if (this._container) {
      this._container.innerHTML = '';
    }
  }

  destroy() {
    this.unmount();
  }
}
