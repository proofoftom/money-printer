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
    
    // Clear positions on startup if configured
    if (config.POSITION_MANAGER.CLEAR_ON_STARTUP) {
      this.clearPositions();
    }
    
    this.loadPositions();
    
    // Periodic state persistence
    setInterval(() => this.savePositions(), config.POSITION_MANAGER.SAVE_INTERVAL);
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
          const position = new Position({
            mint: posData.mint,
            entryPrice: posData.entryPrice,
            size: posData.size,
            entryTime: new Date(posData.entryTime).getTime(),
            symbol: posData.symbol
          });
          
          // Restore position state
          position.currentPrice = posData.currentPrice;
          position.remainingSize = posData.remainingSize;
          position.highPrice = posData.highPrice;
          position.priceHistory = posData.priceHistory || [];
          position.volumeHistory = posData.volumeHistory || [];
          position.candleHistory = posData.candleHistory || [];
          position.profitHistory = posData.profitHistory || [];
          position.partialExits = posData.partialExits || [];
          
          // Set up event listeners
          position.on('updated', (pos) => this.emit('positionUpdated', pos));
          position.on('partialExit', (pos) => this.emit('partialExit', pos));
          position.on('closed', (pos) => this.emit('positionClosed', pos));
          
          this.positions.set(position.mint, position);
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
        positions: Array.from(this.positions.values()).map(position => ({
          mint: position.mint,
          entryPrice: position.entryPrice,
          size: position.size,
          currentPrice: position.currentPrice,
          remainingSize: position.remainingSize,
          highPrice: position.highPrice,
          entryTime: position.entryTime,
          symbol: position.symbol,
          priceHistory: position.priceHistory,
          volumeHistory: position.volumeHistory,
          candleHistory: position.candleHistory,
          profitHistory: position.profitHistory,
          partialExits: position.partialExits
        })),
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
    
    // Set up event listeners
    position.on('updated', (pos) => this.emit('positionUpdated', pos));
    position.on('partialExit', (pos) => this.emit('partialExit', pos));
    position.on('closed', (pos) => this.emit('positionClosed', pos));
    
    this.positions.set(position.mint, position);
    this.emit('positionAdded', position);
    this.savePositions();
    
    return position;
  }

  closePosition(mint) {
    const position = this.positions.get(mint);
    if (!position) return null;

    this.positions.delete(mint);
    this.savePositions();
    
    return position;
  }

  getPosition(mint) {
    return this.positions.get(mint);
  }

  getActivePositions() {
    return Array.from(this.positions.values());
  }

  getPositionStats() {
    const positions = this.getActivePositions();
    const totalValue = positions.reduce((sum, pos) => 
      sum + (pos.currentPrice * pos.size * pos.remainingSize), 0);
    
    return {
      activePositions: positions.length,
      totalValue
    };
  }

  validatePositions() {
    const now = Date.now();
    const invalidPositions = [];
    
    for (const [mint, position] of this.positions.entries()) {
      // Check for stale positions (no updates in last 5 minutes)
      if (now - position.lastUpdate > 5 * 60 * 1000) {
        invalidPositions.push({
          mint,
          position,
          reason: 'stale'
        });
      }
    }
    
    return invalidPositions;
  }

  clearPositions() {
    this.positions.clear();
    this.savePositions();
  }
}

module.exports = PositionStateManager;
