const EventEmitter = require('events');

class PositionStateManager extends EventEmitter {
  constructor() {
    super();
    this.positions = new Map();
  }

  addPosition(position) {
    this.positions.set(position.mint, {
      ...position,
      lastUpdate: Date.now()
    });
    this.emit('positionAdded', position);
  }

  updatePosition(position) {
    if (!this.positions.has(position.mint)) return;
    
    const updatedPosition = {
      ...position,
      lastUpdate: Date.now()
    };
    
    this.positions.set(position.mint, updatedPosition);
    this.emit('positionUpdated', updatedPosition);
  }

  removePosition(mint) {
    const position = this.positions.get(mint);
    if (position) {
      this.positions.delete(mint);
      this.emit('positionClosed', position);
    }
  }

  getPosition(mint) {
    return this.positions.get(mint);
  }

  hasPosition(mint) {
    return this.positions.has(mint);
  }

  getAllPositions() {
    return Array.from(this.positions.values());
  }
}

module.exports = PositionStateManager;
