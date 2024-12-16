const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const Position = require('./Position');

class PositionStateManager extends EventEmitter {
  constructor() {
    super();
    this.positions = new Map();
    this.stateFile = path.join(process.cwd(), 'data', 'positions.json');
    this.ensureDataDirectory();
    this.loadPositions();

    // Clear positions on startup if configured
    const clearOnStartup = config.POSITION_MANAGER?.CLEAR_ON_STARTUP ?? false;
    if (clearOnStartup) {
      this.clearPositions();
    }
    
    // Periodic state persistence
    const saveInterval = config.POSITION_MANAGER?.SAVE_INTERVAL ?? 60000;
    setInterval(() => this.savePositions(), saveInterval);
  }

  ensureDataDirectory() {
    const dataDir = path.dirname(this.stateFile);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
  }

  loadPositions() {
    try {
      if (fs.existsSync(this.stateFile)) {
        const data = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
        data.positions.forEach(posData => {
          // Reconstruct Position instance from saved data
          const position = new Position({
            mint: posData.mint,
            entryPrice: posData.entryPrice,
            size: posData.size,
            simulatedDelay: posData.simulatedDelay
          });
          
          // Restore position state
          position.fromJSON(posData);
          this.positions.set(posData.mint, position);
        });
        console.log(`Loaded ${this.positions.size} positions from state file`);
      }
    } catch (error) {
      console.error('Error loading positions:', error);
    }
  }

  savePositions() {
    try {
      const data = {
        positions: Array.from(this.positions.values()).map(position => position.toJSON()),
        lastSaved: new Date().toISOString()
      };
      fs.writeFileSync(this.stateFile, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('Error saving positions:', error);
    }
  }

  addPosition(position) {
    if (!(position instanceof Position)) {
      throw new Error('Position must be an instance of Position class');
    }
    
    this.positions.set(position.mint, position);
    this.emit('positionAdded', position);
    this.savePositions();
    
    return position;
  }

  updatePosition(mint, updates) {
    const position = this.positions.get(mint);
    if (!position) return null;

    if (updates instanceof Position) {
      // If updates is a Position instance, replace the existing one
      this.positions.set(mint, updates);
      this.emit('positionUpdated', updates);
      return updates;
    }

    // Apply updates to existing position
    position.update(updates);
    this.emit('positionUpdated', position);
    return position;
  }

  closePosition(mint) {
    const position = this.positions.get(mint);
    if (!position) return null;

    position.close();
    this.emit('positionClosed', position);
    this.positions.delete(mint);
    this.savePositions();
    
    return position;
  }

  validatePositions() {
    const invalidPositions = [];
    
    for (const [mint, position] of this.positions) {
      if (position.isStale()) {
        invalidPositions.push({
          mint,
          reason: 'stale',
          position
        });
        continue;
      }
      
      if (!position.isValid()) {
        invalidPositions.push({
          mint,
          reason: 'invalid',
          position
        });
      }
    }
    
    return invalidPositions;
  }

  getActivePositions() {
    return Array.from(this.positions.values())
      .filter(p => !p.isClosed())
      .sort((a, b) => b.entryTime - a.entryTime);
  }

  getPosition(mint) {
    return this.positions.get(mint);
  }

  getPositionStats() {
    const positions = Array.from(this.positions.values());
    return {
      totalActive: positions.filter(p => !p.isClosed()).length,
      totalValue: positions.reduce((sum, p) => sum + p.getCurrentValue(), 0),
      averageHoldTime: positions.reduce((sum, p) => sum + p.getHoldTime(), 0) / positions.length,
      totalProfitLoss: positions.reduce((sum, p) => sum + p.getProfitLoss().amount, 0)
    };
  }

  clearPositions() {
    this.positions.clear();
    this.savePositions();
  }
}

module.exports = PositionStateManager;
