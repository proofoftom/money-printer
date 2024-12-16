const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

class PositionStateManager extends EventEmitter {
  constructor() {
    super();
    this.positions = new Map();
    this.stateFile = path.join(process.cwd(), 'data', 'positions.json');
    this.ensureDataDirectory();
    this.loadPositions();
    
    // Periodic state persistence
    setInterval(() => this.savePositions(), 30000); // Save every 30 seconds
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
        data.positions.forEach(pos => {
          this.positions.set(pos.mint, {
            ...pos,
            entryTime: new Date(pos.entryTime),
            lastUpdate: new Date(pos.lastUpdate)
          });
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
        positions: Array.from(this.positions.values()),
        lastSaved: new Date().toISOString()
      };
      fs.writeFileSync(this.stateFile, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('Error saving positions:', error);
    }
  }

  addPosition(position) {
    const enrichedPosition = {
      ...position,
      state: 'active',
      lastUpdate: new Date(),
      updates: [],
      partialExits: []
    };
    
    this.positions.set(position.mint, enrichedPosition);
    this.emit('positionAdded', enrichedPosition);
    this.savePositions();
    
    return enrichedPosition;
  }

  updatePosition(mint, updates) {
    const position = this.positions.get(mint);
    if (!position) return null;

    const updatedPosition = {
      ...position,
      ...updates,
      lastUpdate: new Date()
    };

    // Track price history
    if (updates.currentPrice) {
      updatedPosition.updates.push({
        timestamp: new Date(),
        price: updates.currentPrice,
        type: 'priceUpdate'
      });
    }

    // Update max drawdown and upside
    if (updates.currentPrice > position.highestPrice) {
      updatedPosition.highestPrice = updates.currentPrice;
      updatedPosition.maxUpside = ((updates.currentPrice - position.entryPrice) / position.entryPrice) * 100;
    }
    if (updates.currentPrice < position.lowestPrice) {
      updatedPosition.lowestPrice = updates.currentPrice;
      updatedPosition.maxDrawdown = ((position.entryPrice - updates.currentPrice) / position.entryPrice) * 100;
    }

    this.positions.set(mint, updatedPosition);
    this.emit('positionUpdated', updatedPosition);
    
    return updatedPosition;
  }

  recordPartialExit(mint, exitData) {
    const position = this.positions.get(mint);
    if (!position) return null;

    position.partialExits.push({
      ...exitData,
      timestamp: new Date()
    });
    
    position.remainingSize = exitData.remainingSize;
    this.positions.set(mint, position);
    this.emit('partialExit', position);
    
    return position;
  }

  closePosition(mint) {
    const position = this.positions.get(mint);
    if (!position) return null;

    position.state = 'closed';
    position.closedAt = new Date();
    
    this.emit('positionClosed', position);
    this.positions.delete(mint);
    this.savePositions();
    
    return position;
  }

  validatePositions() {
    const invalidPositions = [];
    
    for (const [mint, position] of this.positions) {
      // Check for stale positions (no updates in 5 minutes)
      const staleThreshold = 5 * 60 * 1000; // 5 minutes
      if (Date.now() - position.lastUpdate > staleThreshold) {
        invalidPositions.push({
          mint,
          reason: 'stale',
          position
        });
      }
      
      // Check for invalid state transitions
      if (position.state !== 'active' && position.state !== 'closed') {
        invalidPositions.push({
          mint,
          reason: 'invalidState',
          position
        });
      }
      
      // Check for inconsistent remaining size
      if (position.remainingSize < 0 || position.remainingSize > 1) {
        invalidPositions.push({
          mint,
          reason: 'invalidSize',
          position
        });
      }
    }
    
    return invalidPositions;
  }

  getActivePositions() {
    return Array.from(this.positions.values())
      .filter(p => p.state === 'active')
      .sort((a, b) => b.entryTime - a.entryTime);
  }

  getPosition(mint) {
    return this.positions.get(mint);
  }

  getPositionStats() {
    const positions = Array.from(this.positions.values());
    return {
      totalActive: positions.filter(p => p.state === 'active').length,
      totalValue: positions.reduce((sum, p) => sum + (p.size * p.currentPrice), 0),
      averageHoldTime: positions.reduce((sum, p) => sum + (Date.now() - p.entryTime), 0) / positions.length,
      totalProfitLoss: positions.reduce((sum, p) => {
        const pl = ((p.currentPrice - p.entryPrice) / p.entryPrice) * p.size;
        return sum + pl;
      }, 0)
    };
  }
}

module.exports = PositionStateManager;
