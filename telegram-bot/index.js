const TelegramBot = require('node-telegram-bot-api');
const path = require('path');
const fs = require('fs');

// Services
const ApiService = require('./services/apiService');
const StateService = require('./services/stateService');
const BotHandlersService = require('./services/botHandlersService');

// Configuration
const CONSTANTS = require('../config/constants.cjs');

// Load BOT_TOKEN from env or fallback to .bot_token file
let BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  const tokenFile = path.join(__dirname, '.bot_token');
  if (fs.existsSync(tokenFile)) {
    BOT_TOKEN = fs.readFileSync(tokenFile, 'utf8').trim();
    console.log('📝 Loaded BOT_TOKEN from .bot_token file');
  }
}
if (!BOT_TOKEN) {
  console.error('Missing BOT_TOKEN. Set BOT_TOKEN env or create .bot_token file.');
  process.exit(1);
}
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
