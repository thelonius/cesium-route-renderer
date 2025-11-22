const TelegramBot = require('node-telegram-bot-api');
const path = require('path');

// Services
const ApiService = require('./services/apiService');
const StateService = require('./services/stateService');
const BotHandlersService = require('./services/botHandlersService');

// Configuration
const CONSTANTS = require('../config/constants.cjs');

const BOT_TOKEN = '8418496404:AAGLdVNW_Pla_u1bMVfFia-s9klwRsgYZhs';
const API_SERVER = process.env.API_SERVER || 'http://localhost:3000';
const PUBLIC_URL = process.env.PUBLIC_URL || 'http://195.133.27.96:3000';

console.log('🤖 Telegram bot starting...');

// Initialize bot
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Initialize services
const apiService = new ApiService(API_SERVER, PUBLIC_URL);
const stateService = new StateService(CONSTANTS.TELEGRAM.HISTORY_LIMIT);
const handlersService = new BotHandlersService(bot, apiService, stateService, BOT_TOKEN);

// Initialize state service and register handlers
(async () => {
  try {
    await stateService.initialize();
    handlersService.registerHandlers();

    console.log('✅ Telegram bot ready!');
    console.log(`📡 API Server: ${API_SERVER}`);
    console.log(`🌐 Public URL: ${PUBLIC_URL}`);
    console.log(`📊 State: ${stateService.getStats().totalUsers} users, ${stateService.getStats().totalRoutes} routes`);
  } catch (error) {
    console.error('❌ Bot initialization failed:', error);
    process.exit(1);
  }
})();

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down bot...');

  // Stop progress monitoring
  handlersService.stopAllMonitoring();

  // Save state
  await stateService.saveHistory();

  // Stop bot
  await bot.stopPolling();

  console.log('✅ Bot stopped gracefully');
  process.exit(0);
});

// Error handling
bot.on('polling_error', (error) => {
  console.error('Polling error:', error.code, error.message);
});

bot.on('error', (error) => {
  console.error('Bot error:', error);
});

console.log('🔄 Bot is now polling for messages...');
