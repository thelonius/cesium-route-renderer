const TelegramBot = require('node-telegram-bot-api');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const BOT_TOKEN = '8418496404:AAGLdVNW_Pla_u1bMVfFia-s9klwRsgYZhs';
const API_SERVER = 'http://localhost:3000';

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

console.log('🤖 Telegram bot started!');

// Store active renders
const activeRenders = new Map();

// Welcome message
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId,
    '🗺️ Welcome to GPX Route Video Renderer!\n\n' +
    'Send me a GPX file and I\'ll create a beautiful 3D video animation of your route.\n\n' +
    '📱 Video format: Vertical (1080x1920) perfect for mobile\n' +
    '🎥 Features: Intro/outro animations, smooth camera tracking\n' +
    '⏱️ Processing time: ~2-3 minutes per route\n\n' +
    'Just send me your GPX file to get started!'
  );
});

// Help command
bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId,
    '📖 How to use:\n\n' +
    '1️⃣ Send me a GPX file (as document)\n' +
    '2️⃣ Wait for processing (you\'ll get progress updates)\n' +
    '3️⃣ Receive your video!\n\n' +
    '💡 Tips:\n' +
    '• Routes without timestamps will use 5 km/h walking speed\n' +
    '• Animation plays at 100x speed\n' +
    '• Video includes 5s intro and 4s outro\n\n' +
    'Commands:\n' +
    '/start - Start the bot\n' +
    '/help - Show this help\n' +
    '/status - Check current render status'
  );
});

// Status command
bot.onText(/\/status/, (msg) => {
  const chatId = msg.chat.id;
  const render = activeRenders.get(chatId);

  if (!render) {
    bot.sendMessage(chatId, '❌ No active renders. Send me a GPX file to start!');
    return;
  }

  bot.sendMessage(chatId,
    `⏳ Current status: ${render.status}\n` +
    `📊 Output ID: ${render.outputId || 'pending'}`
  );
});

// Handle document (GPX file)
bot.on('document', async (msg) => {
  const chatId = msg.chat.id;
  const doc = msg.document;

  // Check if it's a GPX file
  if (!doc.file_name.toLowerCase().endsWith('.gpx')) {
    bot.sendMessage(chatId, '❌ Please send a GPX file (.gpx extension)');
    return;
  }

  try {
    // Send initial message
    await bot.sendMessage(chatId, '📥 Downloading your GPX file...');

    // Download the file
    const file = await bot.getFile(doc.file_id);
    const filePath = file.file_path;
    const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;

    const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });
    const gpxBuffer = Buffer.from(response.data);

    // Save temporarily
    const tempPath = path.join(__dirname, 'temp', `${Date.now()}.gpx`);
    fs.mkdirSync(path.dirname(tempPath), { recursive: true });
    fs.writeFileSync(tempPath, gpxBuffer);

    await bot.sendMessage(chatId, '🚀 Starting video rendering...');

    // Track this render
    activeRenders.set(chatId, {
      status: 'rendering',
      outputId: null,
      fileName: doc.file_name
    });

    // Submit to render API
    const formData = new FormData();
    formData.append('gpx', fs.createReadStream(tempPath));

    let renderResponse;
    try {
      renderResponse = await axios.post(`${API_SERVER}/render-route`, formData, {
        headers: formData.getHeaders(),
        maxBodyLength: Infinity,
        maxContentLength: Infinity
      });
    } catch (err) {
      // Surface HTTP / network errors with any response body for easier debugging
      const respData = err.response && err.response.data ? err.response.data : null;
      console.error('Render API request failed:', err.message, respData || 'no response body');
      throw new Error('Render API request failed: ' + (respData ? JSON.stringify(respData) : err.message));
    }

    const result = renderResponse.data;

    if (!result || !result.success) {
      console.error('Render API returned unsuccessful response:', result);
      const details = result && (result.error || result.details) ? (result.error || result.details) : JSON.stringify(result);
      throw new Error('Render failed: ' + details);
    }

    // Update status
    activeRenders.set(chatId, {
      status: 'completed',
      outputId: result.outputId,
      fileName: doc.file_name,
      videoPath: result.videoUrl
    });

    await bot.sendMessage(chatId,
      '✅ Rendering complete!\n' +
      `📁 File size: ${(result.fileSize / 1024 / 1024).toFixed(2)} MB\n` +
      '📤 Uploading video to Telegram...'
    );

    // Send the video
    const videoPath = path.join(__dirname, '..', result.videoUrl.substring(1)); // Remove leading /

    if (fs.existsSync(videoPath)) {
      await bot.sendVideo(chatId, videoPath, {
        caption: `🎬 Your route video: ${doc.file_name}\n\n` +
                 `📊 Size: ${(result.fileSize / 1024 / 1024).toFixed(2)} MB\n` +
                 `🎥 Format: 1080x1920 (Vertical)\n` +
                 `⚡ Animation: 100x speed`,
        supports_streaming: true
      });

      await bot.sendMessage(chatId,
        '🎉 Done! Send another GPX file to create more videos.\n\n' +
        'Use /help for more information.'
      );
    } else {
      throw new Error('Video file not found');
    }

    // Cleanup
    fs.unlinkSync(tempPath);
    activeRenders.delete(chatId);

  } catch (error) {
    console.error('Error processing GPX:', error);

    // Prepare a safe short message for Telegram (avoid sending massive error bodies)
    const MAX_TELEGRAM_TEXT = 3500;

    // Prefer structured response body when available (server returned JSON in err.response.data)
    let detailText = '';
    if (error && error.response && error.response.data) {
      try {
        detailText = typeof error.response.data === 'string' ? error.response.data : JSON.stringify(error.response.data, null, 2);
      } catch (e) {
        detailText = String(error.response.data);
      }
    } else if (error && error.message) {
      detailText = error.message;
    } else {
      detailText = String(error);
    }

    try {
      if (detailText.length <= MAX_TELEGRAM_TEXT) {
        await bot.sendMessage(chatId,
          '❌ Error processing your GPX file:\n' +
          detailText + '\n\n' +
          'Please try again or contact support.'
        );
      } else {
        // Write the long error to a temporary file and send as a document
        const errFileDir = path.join(__dirname, 'temp');
        fs.mkdirSync(errFileDir, { recursive: true });
        const errFilePath = path.join(errFileDir, `render-error-${Date.now()}.txt`);
        fs.writeFileSync(errFilePath, detailText);

        await bot.sendMessage(chatId,
          '❌ Error processing your GPX file. Details too long to display here — sending as a file.'
        );

        await bot.sendDocument(chatId, errFilePath, {}, { filename: 'render-error.txt' });

        // Cleanup
        try { fs.unlinkSync(errFilePath); } catch (e) { /* ignore */ }
      }
    } catch (sendErr) {
      // If sending the message/document fails, ensure we still log it to server console
      console.error('Failed to notify user via Telegram:', sendErr);
    }

    activeRenders.delete(chatId);
  }
});

// Handle other messages
bot.on('message', (msg) => {
  const chatId = msg.chat.id;

  // Ignore commands and documents (handled separately)
  if (msg.text && msg.text.startsWith('/')) return;
  if (msg.document) return;

  bot.sendMessage(chatId,
    '🤔 I can only process GPX files.\n\n' +
    'Please send me a GPX file (as document) to create a route video.\n' +
    'Use /help for more information.'
  );
});

// Error handling
bot.on('polling_error', (error) => {
  console.error('Polling error:', error);
});

process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down bot...');
  bot.stopPolling();
  process.exit(0);
});
