// Ported from ttyd's OverlayAddon (MIT License)
// Original: https://github.com/tsl0922/ttyd
// Based on hterm.Terminal.prototype.showOverlay from Chromium's libapps

export class OverlayAddon {
  constructor() {
    this._terminal = null;
    this._overlayNode = document.createElement('div');
    this._overlayNode.classList.add('xterm-overlay');
    this._overlayTimeout = null;

    this._overlayNode.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    }, true);
  }

  activate(terminal) {
    this._terminal = terminal;
  }

  dispose() {
    if (this._overlayTimeout) clearTimeout(this._overlayTimeout);
    if (this._overlayNode.parentNode) {
      this._overlayNode.parentNode.removeChild(this._overlayNode);
    }
  }

  showOverlay(msg, timeout) {
    const { _terminal: terminal, _overlayNode: node } = this;
    if (!terminal || !terminal.element) return;

    node.textContent = msg;
    node.style.opacity = '0.85';

    if (!node.parentNode) {
      terminal.element.appendChild(node);
    }

    const termRect = terminal.element.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    node.style.top = Math.round((termRect.height - nodeRect.height) / 2) + 'px';
    node.style.left = Math.round((termRect.width - nodeRect.width) / 2) + 'px';

    if (this._overlayTimeout) clearTimeout(this._overlayTimeout);
    if (timeout === undefined || timeout === null) return;

    this._overlayTimeout = setTimeout(() => {
      node.style.opacity = '0';
      this._overlayTimeout = setTimeout(() => {
        if (node.parentNode) {
          node.parentNode.removeChild(node);
        }
        this._overlayTimeout = null;
        node.style.opacity = '0.85';
      }, 200);
    }, timeout);
  }
}
