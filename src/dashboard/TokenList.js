const blessed = require('blessed');
const contrib = require('blessed-contrib');

class TokenList {
  constructor(container, options = {}) {
    this.container = container;
    this.tokens = new Map();
    this.selectedIndex = 0;
    
    this.initializeList();
    this.setupKeyboardHandlers();
  }

  initializeList() {
    this.list = blessed.list({
      parent: this.container,
      label: ' Tokens ',
      tags: true,
      keys: true,
      vi: true,
      mouse: true,
      border: { type: 'line' },
      style: {
        selected: {
          bg: 'blue',
          bold: true
        },
        border: {
          fg: 'white'
        }
      },
      scrollbar: {
        ch: ' ',
        track: {
          bg: 'gray'
        },
        style: {
          inverse: true
        }
      }
    });
  }

  setupKeyboardHandlers() {
    this.list.key(['up', 'k'], () => {
      this.selectPrevious();
    });

    this.list.key(['down', 'j'], () => {
      this.selectNext();
    });

    this.list.key(['enter'], () => {
      const selected = this.getSelectedToken();
      if (selected) {
        this.emit('tokenSelected', selected);
      }
    });
  }

  updateTokens(tokens) {
    this.tokens.clear();
    const items = [];

    tokens.forEach(token => {
      this.tokens.set(token.mint, token);
      const status = this.getTokenStatus(token);
      items.push(this.formatTokenListItem(token, status));
    });

    this.list.setItems(items);
    this.container.screen.render();
  }

  getTokenStatus(token) {
    if (token.inPosition) return '{yellow-fg}IN POSITION{/}';
    if (token.heatingUp) return '{green-fg}HEATING UP{/}';
    if (token.drawdown) return '{red-fg}DRAWDOWN{/}';
    return '{white-fg}ACTIVE{/}';
  }

  formatTokenListItem(token, status) {
    const price = token.currentPrice.toFixed(6);
    const volume = token.volume24h.toFixed(2);
    return `${token.symbol} | ${price} | ${volume} SOL | ${status}`;
  }

  selectPrevious() {
    if (this.selectedIndex > 0) {
      this.selectedIndex--;
      this.list.select(this.selectedIndex);
      this.container.screen.render();
    }
  }

  selectNext() {
    if (this.selectedIndex < this.tokens.size - 1) {
      this.selectedIndex++;
      this.list.select(this.selectedIndex);
      this.container.screen.render();
    }
  }

  getSelectedToken() {
    const selectedItem = this.list.getItem(this.selectedIndex);
    if (!selectedItem) return null;
    
    const mint = Array.from(this.tokens.keys())[this.selectedIndex];
    return this.tokens.get(mint);
  }

  focus() {
    this.list.focus();
  }
}

module.exports = TokenList;
