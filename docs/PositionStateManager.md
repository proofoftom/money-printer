# Position State Manager

The `PositionStateManager` class is responsible for managing the persistence and recovery of position states in the Money Printer system. It ensures data integrity, handles state transitions, and provides recovery mechanisms for the trading system.

## Features

- Position state persistence
- State recovery and validation
- Automatic state backups
- Corruption detection and repair
- Event-driven updates
- Performance optimization
- Security measures

## Class Structure

### Constructor
```javascript
constructor({
  config,
  statsLogger,
  eventEmitter,
  encryption = null
}) {
  this.config = config;
  this.statsLogger = statsLogger;
  this.eventEmitter = eventEmitter;
  this.encryption = encryption;
  
  this.stateFile = config.STATE_FILE;
  this.backupDir = config.BACKUP_DIR;
  this.positions = new Map();
  
  this.initialize();
}
```

### Core Methods

#### State Management
```javascript
async savePositions(positions)
async loadPositions()
async validateState(positions)
async repairState()
```

#### Backup Management
```javascript
async createBackup()
async restoreFromBackup(timestamp)
async pruneOldBackups()
listBackups()
```

#### Recovery
```javascript
async attemptRecovery()
async validateBackup(backup)
async mergeStates(current, backup)
```

## Events

### State Events
- `stateSaved`: Position states saved
- `stateLoaded`: Position states loaded
- `stateValidated`: Validation complete
- `stateCorrupted`: Corruption detected
- `stateRepaired`: Repair complete

### Backup Events
- `backupCreated`: New backup created
- `backupRestored`: Backup restored
- `backupPruned`: Old backups removed
- `backupFailed`: Backup operation failed

### Error Events
- `error`: General error occurred
- `validationError`: Validation failed
- `persistenceError`: Save/load failed
- `recoveryError`: Recovery failed

## Integration

### With Position Class
```javascript
// Save position state
async savePosition(position) {
  const state = position.toJSON();
  if (this.encryption) {
    state.data = await this.encryption.encrypt(state.data);
  }
  await this.writeState(position.id, state);
  this.emit('stateSaved', { position: position.id });
}

// Load position state
async loadPosition(id) {
  const state = await this.readState(id);
  if (this.encryption) {
    state.data = await this.encryption.decrypt(state.data);
  }
  return Position.fromJSON(state);
}
```

### With StatsLogger
```javascript
// Log state events
logStateEvent(event, data) {
  this.statsLogger.logStats({
    type: 'STATE_MANAGEMENT',
    event,
    timestamp: Date.now(),
    ...data
  });
}
```

## File Structure

```
/state
  ├── positions.json       # Current position states
  ├── positions.json.bak   # Immediate backup
  └── backups/
      ├── positions_20241216_101500.json
      ├── positions_20241216_102000.json
      └── positions_20241216_102500.json
```

## Example Usage

```javascript
// Initialize manager
const stateManager = new PositionStateManager({
  config,
  statsLogger,
  eventEmitter,
  encryption
});

// Save positions
await stateManager.savePositions(positions);

// Load positions
const savedPositions = await stateManager.loadPositions();

// Create backup
await stateManager.createBackup();

// Restore from backup
await stateManager.restoreFromBackup('20241216_101500');

// Validate state
const isValid = await stateManager.validateState(positions);

// Repair corrupted state
if (!isValid) {
  await stateManager.repairState();
}
```

## Configuration

```javascript
{
  POSITION_STATE_MANAGER: {
    STATE_FILE: './state/positions.json',
    BACKUP_DIR: './state/backups',
    BACKUP_INTERVAL: 300000,    // 5 minutes
    MAX_BACKUPS: 24,           // Keep last 24 backups
    VALIDATION: {
      ENABLED: true,
      INTERVAL: 60000,         // 1 minute
      REPAIR_ATTEMPTS: 3
    },
    PERSISTENCE: {
      ATOMIC_WRITES: true,
      COMPRESSION: true,
      ENCRYPTION: {
        ENABLED: true,
        ALGORITHM: 'aes-256-gcm'
      }
    },
    RECOVERY: {
      MAX_ATTEMPTS: 3,
      BACKUP_THRESHOLD: 3600000 // 1 hour
    }
  }
}
```

## Error Handling

```javascript
try {
  await this.savePositions(positions);
} catch (error) {
  this.emit('error', {
    error,
    context: 'savePositions',
    positions: positions.size
  });
  
  // Attempt recovery
  try {
    await this.attemptRecovery();
  } catch (recoveryError) {
    this.emit('recoveryError', {
      error: recoveryError,
      context: 'stateRecovery'
    });
  }
}
```

## State Validation

The PositionStateManager performs comprehensive validation:

1. Schema Validation
```javascript
validateSchema(state) {
  const schema = this.getStateSchema();
  return this.validator.validate(state, schema);
}
```

2. Data Integrity
```javascript
validateIntegrity(state) {
  return {
    checksumValid: this.validateChecksum(state),
    structureValid: this.validateStructure(state),
    relationshipsValid: this.validateRelationships(state)
  };
}
```

3. Cross-Reference Validation
```javascript
validateReferences(positions) {
  for (const position of positions.values()) {
    if (!this.validatePositionReferences(position)) {
      return false;
    }
  }
  return true;
}
```

## Performance Optimization

1. Efficient State Storage
```javascript
async optimizeState(state) {
  // Compress state
  if (this.config.PERSISTENCE.COMPRESSION) {
    state = await this.compress(state);
  }
  
  // Encrypt if needed
  if (this.encryption) {
    state = await this.encryption.encrypt(state);
  }
  
  return state;
}
```

2. Batch Processing
```javascript
async batchSavePositions(positions) {
  const batch = new Map();
  for (const [id, position] of positions) {
    batch.set(id, await this.optimizeState(position.toJSON()));
  }
  await this.writeBatch(batch);
}
```

## Security Measures

1. Data Encryption
```javascript
async encryptState(state) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(
    this.config.PERSISTENCE.ENCRYPTION.ALGORITHM,
    this.encryptionKey,
    iv
  );
  
  let encrypted = cipher.update(JSON.stringify(state), 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  return {
    iv: iv.toString('hex'),
    data: encrypted,
    tag: cipher.getAuthTag().toString('hex')
  };
}
```

2. Atomic Writes
```javascript
async atomicWrite(path, data) {
  const tempPath = `${path}.tmp`;
  await fs.writeFile(tempPath, data);
  await fs.rename(tempPath, path);
}
```

## Best Practices

1. Regular backups
2. Validation checks
3. Error handling
4. Data encryption
5. Performance optimization
6. Recovery procedures
7. Audit logging
8. Security measures
