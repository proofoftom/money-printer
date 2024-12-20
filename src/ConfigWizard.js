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
    await this.promptSection('Dashboard Layout', this.dashboardLayoutQuestions);
    await this.promptSection('Chart Settings', this.chartQuestions);
    await this.promptSection('Alert Configuration', this.alertQuestions);
    await this.promptSection('Keyboard Shortcuts', this.shortcutQuestions);
    await this.promptSection('Notification Preferences', this.notificationQuestions);
    await this.promptSection('Export Settings', this.exportQuestions);
    await this.promptSection('Logging Preferences', this.loggingQuestions);
    
    await this.showDashboardPreview();
    await this.confirmSave();
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
        type: 'input',
        name: 'SHORTCUTS.OPEN_POSITION',
        message: 'Key for opening a position:',
        default: this.config.SHORTCUTS?.OPEN_POSITION || 'o',
        validate: value => value.length === 1 ? true : 'Please enter a single character'
      },
      {
        type: 'input',
        name: 'SHORTCUTS.CLOSE_POSITION',
        message: 'Key for closing a position:',
        default: this.config.SHORTCUTS?.CLOSE_POSITION || 'c',
        validate: value => value.length === 1 ? true : 'Please enter a single character'
      },
      {
        type: 'input',
        name: 'SHORTCUTS.TOKEN_DETAILS',
        message: 'Key for viewing token details:',
        default: this.config.SHORTCUTS?.TOKEN_DETAILS || 't',
        validate: value => value.length === 1 ? true : 'Please enter a single character'
      },
      {
        type: 'input',
        name: 'SHORTCUTS.HELP',
        message: 'Key for help menu:',
        default: this.config.SHORTCUTS?.HELP || '?',
        validate: value => value.length === 1 ? true : 'Please enter a single character'
      }
    ];
  }

  get loggingQuestions() {
    return [
      {
        type: 'confirm',
        name: 'LOGGING_ENABLED',
        message: 'Enable logging?',
        default: this.config.LOGGING_ENABLED
      },
      {
        type: 'list',
        name: 'LOG_LEVEL',
        message: 'Select log level:',
        choices: [
          { name: 'Error', value: 'error' },
          { name: 'Warning', value: 'warn' },
          { name: 'Info', value: 'info' },
          { name: 'Debug', value: 'debug' }
        ],
        default: this.config.LOG_LEVEL || 'info',
        when: answers => answers.LOGGING_ENABLED
      },
      {
        type: 'checkbox',
        name: 'eventLogging',
        message: 'Select events to log:',
        choices: [
          { 
            name: 'New Tokens', 
            value: 'NEW_TOKENS', 
            checked: this.config.LOGGING?.NEW_TOKENS
          },
          { 
            name: 'Trades', 
            value: 'TRADES', 
            checked: this.config.LOGGING?.TRADES 
          },
          { 
            name: 'Positions', 
            value: 'POSITIONS', 
            checked: this.config.LOGGING?.POSITIONS 
          },
          { 
            name: 'Safety Checks', 
            value: 'SAFETY_CHECKS', 
            checked: this.config.LOGGING?.SAFETY_CHECKS 
          }
        ],
        when: answers => answers.LOGGING_ENABLED
      },
      {
        type: 'input',
        name: 'LOGGING_SETTINGS.MAX_SIZE',
        message: 'Maximum log file size (e.g., "20m", "1g"):',
        default: this.config.LOGGING_SETTINGS?.MAX_SIZE || '20m',
        when: answers => answers.LOGGING_ENABLED
      },
      {
        type: 'input',
        name: 'LOGGING_SETTINGS.MAX_FILES',
        message: 'Log retention period (e.g., "14d", "1m"):',
        default: this.config.LOGGING_SETTINGS?.MAX_FILES || '14d',
        when: answers => answers.LOGGING_ENABLED
      }
    ];
  }

  async showDashboardPreview() {
    console.log(chalk.blue.bold('\n📊 Dashboard Preview'));
    
    // Create a simple ASCII preview of the dashboard layout
    const preview = [
      '┌─────────────────────┬────────────────────┐',
      '│                     │    Wallet Info     │',
      '│      Price Chart    │──────────────────  │',
      '│                     │  Active Positions   │',
      '│                     │──────────────────  │',
      '│                     │   Token Metrics    │',
      '├─────────────────────┼────────────────────┤',
      '│      Log/Events     │      Alerts        │',
      '└─────────────────────┴────────────────────┘',
      '        Status Bar: Connected | P&L: +0.5 SOL        '
    ].join('\n');

    console.log(preview);
    
    return inquirer.prompt([
      {
        type: 'confirm',
        name: 'layoutConfirm',
        message: 'Does this layout look good?',
        default: true
      }
    ]);
  }

  async confirmSave() {
    return inquirer.prompt([
      {
        type: 'confirm',
        name: 'saveConfirm',
        message: 'Save changes?',
        default: true
      }
    ]);
  }

  get dashboardLayoutQuestions() {
    return [
      {
        type: 'list',
        name: 'DASHBOARD.COLORS.THEME',
        message: 'Choose a color theme:',
        choices: [
          { name: 'Dark (Default)', value: 'dark' },
          { name: 'Light', value: 'light' },
          { name: 'High Contrast', value: 'contrast' }
        ],
        default: 'dark'
      },
      {
        type: 'number',
        name: 'DASHBOARD.REFRESH_RATE',
        message: 'UI refresh rate (milliseconds):',
        default: this.config.DASHBOARD?.REFRESH_RATE || 1000,
        validate: value => value >= 100 && value <= 5000 ? true : 'Please enter a value between 100 and 5000'
      },
      {
        type: 'number',
        name: 'DASHBOARD.LOG_BUFFER',
        message: 'Number of log lines to keep in memory:',
        default: this.config.DASHBOARD?.LOG_BUFFER || 1000,
        validate: value => value >= 100 && value <= 10000 ? true : 'Please enter a value between 100 and 10000'
      }
    ];
  }

  get chartQuestions() {
    return [
      {
        type: 'number',
        name: 'DASHBOARD.CHART.CANDLE_INTERVAL',
        message: 'Candle interval (milliseconds):',
        default: this.config.DASHBOARD?.CHART?.CANDLE_INTERVAL || 5000,
        validate: value => value >= 1000 && value <= 60000 ? true : 'Please enter a value between 1000 and 60000'
      },
      {
        type: 'number',
        name: 'DASHBOARD.CHART.MAX_CANDLES',
        message: 'Maximum number of candles to display:',
        default: this.config.DASHBOARD?.CHART?.MAX_CANDLES || 100,
        validate: value => value >= 20 && value <= 500 ? true : 'Please enter a value between 20 and 500'
      },
      {
        type: 'number',
        name: 'DASHBOARD.CHART.PRICE_DECIMALS',
        message: 'Number of decimal places for price display:',
        default: this.config.DASHBOARD?.CHART?.PRICE_DECIMALS || 9,
        validate: value => value >= 0 && value <= 12 ? true : 'Please enter a value between 0 and 12'
      }
    ];
  }

  get alertQuestions() {
    return [
      {
        type: 'confirm',
        name: 'ALERTS.PRICE_CHANGE.enabled',
        message: 'Enable price change alerts?',
        default: this.config.ALERTS?.PRICE_CHANGE?.enabled ?? true
      },
      {
        type: 'number',
        name: 'ALERTS.PRICE_CHANGE.threshold',
        message: 'Price change alert threshold (%):',
        default: this.config.ALERTS?.PRICE_CHANGE?.threshold || 5,
        when: answers => answers['ALERTS.PRICE_CHANGE.enabled'],
        validate: value => value > 0 && value <= 100 ? true : 'Please enter a value between 0 and 100'
      },
      {
        type: 'confirm',
        name: 'ALERTS.WALLET_BALANCE.enabled',
        message: 'Enable wallet balance alerts?',
        default: this.config.ALERTS?.WALLET_BALANCE?.enabled ?? true
      },
      {
        type: 'number',
        name: 'ALERTS.WALLET_BALANCE.threshold',
        message: 'Wallet balance alert threshold (%):',
        default: this.config.ALERTS?.WALLET_BALANCE?.threshold || 10,
        when: answers => answers['ALERTS.WALLET_BALANCE.enabled'],
        validate: value => value > 0 && value <= 100 ? true : 'Please enter a value between 0 and 100'
      },
      {
        type: 'confirm',
        name: 'ALERTS.SOUNDS.TRADE_ENTRY',
        message: 'Play sound on trade entry?',
        default: this.config.ALERTS?.SOUNDS?.TRADE_ENTRY ?? true
      },
      {
        type: 'confirm',
        name: 'ALERTS.SOUNDS.TRADE_EXIT',
        message: 'Play sound on trade exit?',
        default: this.config.ALERTS?.SOUNDS?.TRADE_EXIT ?? true
      }
    ];
  }

  async saveChanges() {
    try {
      // Process logging answers
      if (this.changes.eventLogging) {
        this.changes.LOGGING = {
          NEW_TOKENS: this.changes.eventLogging.includes('NEW_TOKENS'),
          TRADES: this.changes.eventLogging.includes('TRADES'),
          POSITIONS: this.changes.eventLogging.includes('POSITIONS'),
          SAFETY_CHECKS: this.changes.eventLogging.includes('SAFETY_CHECKS')
        };
        delete this.changes.eventLogging;
      }

      // Update config object with changes
      this.updateConfig(this.changes);
      
      // Save to config file
      const configPath = path.join(process.cwd(), 'config.json');
      await fs.writeFile(configPath, JSON.stringify(this.config, null, 2));
      
      console.log(chalk.green('\n✨ Configuration saved successfully!\n'));
    } catch (error) {
      console.error(chalk.red('\n❌ Failed to save configuration:', error.message));
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
    if (changes.LOGGING_ENABLED !== undefined) {
      this.config.LOGGING_ENABLED = changes.LOGGING_ENABLED;
    }

    if (changes.LOG_LEVEL) {
      this.config.LOG_LEVEL = changes.LOG_LEVEL;
    }

    if (changes.LOGGING) {
      this.config.LOGGING = changes.LOGGING;
    }

    if (changes.LOGGING_SETTINGS) {
      this.config.LOGGING_SETTINGS = changes.LOGGING_SETTINGS;
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
