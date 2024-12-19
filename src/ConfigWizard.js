const inquirer = require('inquirer');
const fs = require('fs').promises;
const path = require('path');
const chalk = require('chalk');

class ConfigWizard {
  constructor(config) {
    this.config = config;
    this.changes = {};
  }

  async start() {
    console.log(chalk.blue.bold('\n🔧 Welcome to the Money Printer Configuration Wizard 🖨️\n'));
    
    await this.promptSection('Risk Parameters', this.riskQuestions);
    await this.promptSection('Notification Preferences', this.notificationQuestions);
    await this.promptSection('Export Settings', this.exportQuestions);
    await this.promptSection('Keyboard Shortcuts', this.shortcutQuestions);
    await this.promptSection('Logging Preferences', this.loggingQuestions);
    
    await this.saveChanges();
  }

  async promptSection(title, questions) {
    console.log(chalk.yellow.bold(`\n${title}`));
    const answers = await inquirer.prompt(questions);
    this.changes = { ...this.changes, ...answers };
  }

  get riskQuestions() {
    return [
      {
        type: 'number',
        name: 'RISK_PER_TRADE',
        message: 'What percentage of your wallet to risk per trade?',
        default: this.config.RISK_PER_TRADE * 100,
        validate: value => value > 0 && value <= 100 ? true : 'Please enter a value between 0 and 100',
        filter: value => value / 100
      },
      {
        type: 'number',
        name: 'STOP_LOSS_PERCENT',
        message: 'Stop loss percentage?',
        default: this.config.STOP_LOSS_PERCENT,
        validate: value => value > 0 && value <= 100 ? true : 'Please enter a value between 0 and 100'
      },
      {
        type: 'number',
        name: 'TAKE_PROFIT_PERCENT',
        message: 'Take profit percentage?',
        default: this.config.TAKE_PROFIT_PERCENT,
        validate: value => value > 0 && value <= 1000 ? true : 'Please enter a value between 0 and 1000'
      },
      {
        type: 'number',
        name: 'MAX_ENTRY_MCAP_USD',
        message: 'Maximum market cap for entry (USD)?',
        default: this.config.MAX_ENTRY_MCAP_USD,
        validate: value => value > 0 ? true : 'Please enter a value greater than 0'
      }
    ];
  }

  get notificationQuestions() {
    return [
      {
        type: 'checkbox',
        name: 'notificationTypes',
        message: 'Select notification types to enable:',
        choices: [
          { name: 'Position Entry', value: 'POSITIONS.ENTRY', checked: this.config.NOTIFICATIONS.POSITIONS.ENTRY.enabled },
          { name: 'Position Exit', value: 'POSITIONS.EXIT', checked: this.config.NOTIFICATIONS.POSITIONS.EXIT.enabled },
          { name: 'Connection Issues', value: 'SYSTEM.CONNECTION', checked: this.config.NOTIFICATIONS.SYSTEM.CONNECTION.enabled },
          { name: 'Safety Alerts', value: 'SYSTEM.SAFETY', checked: this.config.NOTIFICATIONS.SYSTEM.SAFETY.enabled },
          { name: 'Performance Milestones', value: 'PERFORMANCE.MILESTONES', checked: this.config.NOTIFICATIONS.PERFORMANCE.MILESTONES.enabled }
        ]
      },
      {
        type: 'checkbox',
        name: 'soundEnabledFor',
        message: 'Enable sound for:',
        choices: [
          { name: 'Position Entry', value: 'POSITIONS.ENTRY' },
          { name: 'Position Exit', value: 'POSITIONS.EXIT' },
          { name: 'Safety Alerts', value: 'SYSTEM.SAFETY' }
        ]
      }
    ];
  }

  get exportQuestions() {
    return [
      {
        type: 'checkbox',
        name: 'exportTypes',
        message: 'Select data types to export:',
        choices: [
          { name: 'Trade History', value: 'TRADES', checked: this.config.DATA_EXPORT.TRADES.enabled },
          { name: 'Performance Metrics', value: 'PERFORMANCE', checked: this.config.DATA_EXPORT.PERFORMANCE.enabled },
          { name: 'Token Statistics', value: 'TOKENS', checked: this.config.DATA_EXPORT.TOKENS.enabled },
          { name: 'System Logs', value: 'SYSTEM', checked: this.config.DATA_EXPORT.SYSTEM.enabled }
        ]
      },
      {
        type: 'checkbox',
        name: 'exportFormats',
        message: 'Select export formats:',
        choices: [
          { name: 'CSV', value: 'CSV', checked: this.config.DATA_EXPORT.FORMATS.CSV.enabled },
          { name: 'JSON', value: 'JSON', checked: this.config.DATA_EXPORT.FORMATS.JSON.enabled }
        ]
      },
      {
        type: 'confirm',
        name: 'autoExport',
        message: 'Enable automatic exports?',
        default: this.config.DATA_EXPORT.AUTO_EXPORT.enabled
      },
      {
        type: 'list',
        name: 'autoExportInterval',
        message: 'Auto-export interval:',
        when: answers => answers.autoExport,
        choices: [
          { name: 'Hourly', value: 3600000 },
          { name: 'Daily', value: 86400000 },
          { name: 'Weekly', value: 604800000 }
        ],
        default: this.config.DATA_EXPORT.AUTO_EXPORT.interval
      }
    ];
  }

  get shortcutQuestions() {
    return [
      {
        type: 'confirm',
        name: 'customizeShortcuts',
        message: 'Would you like to customize keyboard shortcuts?',
        default: false
      },
      {
        type: 'input',
        name: 'KEYBOARD_SHORTCUTS.TRADING.PAUSE_RESUME.key',
        message: 'Key for Pause/Resume trading:',
        when: answers => answers.customizeShortcuts,
        default: this.config.KEYBOARD_SHORTCUTS.TRADING.PAUSE_RESUME.key
      },
      {
        type: 'input',
        name: 'KEYBOARD_SHORTCUTS.TRADING.EMERGENCY_STOP.key',
        message: 'Key for Emergency Stop:',
        when: answers => answers.customizeShortcuts,
        default: this.config.KEYBOARD_SHORTCUTS.TRADING.EMERGENCY_STOP.key
      }
    ];
  }

  get loggingQuestions() {
    return [
      {
        type: 'checkbox',
        name: 'loggingLevels',
        message: 'Select logging levels to enable:',
        choices: [
          { name: 'Error', value: 'ERROR', checked: this.config.LOGGING.LEVELS.ERROR.enabled },
          { name: 'Trade', value: 'TRADE', checked: this.config.LOGGING.LEVELS.TRADE.enabled },
          { name: 'System', value: 'SYSTEM', checked: this.config.LOGGING.LEVELS.SYSTEM.enabled },
          { name: 'Performance', value: 'PERFORMANCE', checked: this.config.LOGGING.LEVELS.PERFORMANCE.enabled },
          { name: 'Debug', value: 'DEBUG', checked: this.config.LOGGING.LEVELS.DEBUG.enabled }
        ]
      },
      {
        type: 'input',
        name: 'LOGGING.DIRECTORY',
        message: 'Log directory:',
        default: this.config.LOGGING.DIRECTORY
      },
      {
        type: 'list',
        name: 'debugLevel',
        message: 'Debug logging level:',
        when: answers => answers.loggingLevels.includes('DEBUG'),
        choices: [
          { name: 'Basic', value: 1 },
          { name: 'Detailed', value: 2 },
          { name: 'Verbose', value: 3 }
        ],
        default: this.config.LOGGING.LEVELS.DEBUG.maxLevel
      }
    ];
  }

  async saveChanges() {
    try {
      // Update config object with changes
      this.updateConfig(this.changes);
      
      // Save to config file
      const configPath = path.join(process.cwd(), 'config.json');
      await fs.writeFile(configPath, JSON.stringify(this.config, null, 2));
      
      console.log(chalk.green.bold('\n✅ Configuration saved successfully!\n'));
    } catch (error) {
      console.error(chalk.red.bold('\n❌ Error saving configuration:', error.message));
      throw error;
    }
  }

  updateConfig(changes) {
    // Update notification settings
    if (changes.notificationTypes) {
      changes.notificationTypes.forEach(type => {
        const [category, subcategory] = type.split('.');
        this.config.NOTIFICATIONS[category][subcategory].enabled = true;
      });
    }

    // Update sound settings
    if (changes.soundEnabledFor) {
      changes.soundEnabledFor.forEach(type => {
        const [category, subcategory] = type.split('.');
        this.config.NOTIFICATIONS[category][subcategory].sound = true;
      });
    }

    // Update export settings
    if (changes.exportTypes) {
      changes.exportTypes.forEach(type => {
        this.config.DATA_EXPORT[type].enabled = true;
      });
    }

    if (changes.exportFormats) {
      changes.exportFormats.forEach(format => {
        this.config.DATA_EXPORT.FORMATS[format].enabled = true;
      });
    }

    if (changes.autoExport !== undefined) {
      this.config.DATA_EXPORT.AUTO_EXPORT.enabled = changes.autoExport;
      if (changes.autoExportInterval) {
        this.config.DATA_EXPORT.AUTO_EXPORT.interval = changes.autoExportInterval;
      }
    }

    // Update logging settings
    if (changes.loggingLevels) {
      Object.keys(this.config.LOGGING.LEVELS).forEach(level => {
        this.config.LOGGING.LEVELS[level].enabled = changes.loggingLevels.includes(level);
      });
    }

    if (changes.debugLevel) {
      this.config.LOGGING.LEVELS.DEBUG.maxLevel = changes.debugLevel;
    }

    // Update direct key-value pairs
    Object.entries(changes).forEach(([key, value]) => {
      if (key.includes('.')) {
        const keys = key.split('.');
        let current = this.config;
        for (let i = 0; i < keys.length - 1; i++) {
          current = current[keys[i]];
        }
        current[keys[keys.length - 1]] = value;
      } else if (typeof value !== 'object') {
        this.config[key] = value;
      }
    });
  }
}

module.exports = ConfigWizard;
