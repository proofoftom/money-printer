const mockConfig = require('./config');

class MockPositionManager {
  constructor() {
    this.positions = new Map();
    this.config = mockConfig();
  }

  clearPositions() {
    this.positions.clear();
  }

  calculateStateMultiplier(state) {
    return this.config.POSITION_MANAGER.STATE_MULTIPLIERS[state] || 1.0;
  }

  calculateConfidenceMultiplier(confidence) {
    const multipliers = this.config.POSITION_MANAGER.CONFIDENCE_MULTIPLIERS;
    if (confidence >= 80) return multipliers.HIGH;
    if (confidence >= 60) return multipliers.MEDIUM_HIGH;
    if (confidence >= 40) return multipliers.MEDIUM;
    if (confidence >= 20) return multipliers.MEDIUM_LOW;
    return multipliers.LOW;
  }

  calculatePositionSize(token) {
    const baseSize = this.config.POSITION_MANAGER.BASE_POSITION_SIZE;
    const stateMultiplier = this.calculateStateMultiplier(token.stateManager.state);
    const confidenceMultiplier = this.calculateConfidenceMultiplier(token.metrics.earlyTrading.confidence || 0);
    return baseSize * stateMultiplier * confidenceMultiplier;
  }

  async enterPosition(token) {
    if (token.metrics.earlyTrading.volumeAcceleration < this.config.SAFETY.MIN_VOLUME_ACCELERATION) {
      return false;
    }
    const size = this.calculatePositionSize(token);
    this.positions.set(token.address, { size, entryPrice: token.currentPrice });
    return true;
  }

  async exitPosition(token, percentage = 1.0) {
    const position = this.positions.get(token.address);
    if (!position) return false;
    
    const exitSize = position.size * percentage;
    position.size -= exitSize;
    
    if (position.size <= 0) {
      this.positions.delete(token.address);
    } else {
      this.positions.set(token.address, position);
    }
    return true;
  }
}

module.exports = MockPositionManager;
