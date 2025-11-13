const TelegramBot = require('node-telegram-bot-api');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { analyzeGPX, analyzeKML, formatAnalytics } = require('./gpxAnalyzer');
const { getUserLanguage, setUserLanguage, t, formatMessage } = require('./i18n');

const BOT_TOKEN = '8418496404:AAGLdVNW_Pla_u1bMVfFia-s9klwRsgYZhs';
const API_SERVER = process.env.API_SERVER || 'http://localhost:3000';
const PUBLIC_URL = process.env.PUBLIC_URL || 'http://195.209.214.96:3000'; // Public URL for downloads

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

console.log('🤖 Telegram bot started!');

// Store active renders
const activeRenders = new Map();

// Store route history (file-based persistence)
const HISTORY_FILE = path.join(__dirname, 'route-history.json');
const routeHistory = new Map();

// Load route history from file
function loadRouteHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const data = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
      Object.entries(data).forEach(([chatId, routes]) => {
        routeHistory.set(parseInt(chatId), routes);
      });
      console.log('📜 Loaded route history for', routeHistory.size, 'users');
    }
  } catch (error) {
    console.error('Error loading route history:', error);
  }
}

// Save route history to file
function saveRouteHistory() {
  try {
    const data = {};
    routeHistory.forEach((routes, chatId) => {
      data[chatId] = routes;
    });
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error saving route history:', error);
  }
}

// Add route to user's history
function addRouteToHistory(chatId, fileName, filePath, videoUrl, fileSize) {
  const history = routeHistory.get(chatId) || [];

  // Add new route at the beginning
  history.unshift({
    fileName,
    filePath,
    videoUrl,
    fileSize,
    timestamp: Date.now(),
    date: new Date().toISOString()
  });

  // Keep only last 10 routes
  if (history.length > 10) {
    history.splice(10);
  }

  routeHistory.set(chatId, history);
  saveRouteHistory();
}

// Load history on startup
loadRouteHistory();

// Welcome message
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const userLang = msg.from.language_code || 'en';
  const message = formatMessage(chatId, 'welcome', {}, userLang);

  bot.sendMessage(chatId, message);
});

// Help command
bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  const userLang = msg.from.language_code || 'en';
  const message = formatMessage(chatId, 'help', {}, userLang);

  bot.sendMessage(chatId, message);
});

// Language command
bot.onText(/\/language/, (msg) => {
  const chatId = msg.chat.id;
  const userLang = msg.from.language_code || 'en';
  const currentLang = getUserLanguage(chatId, userLang);

  bot.sendMessage(chatId, t(chatId, 'language.select', {}, userLang), {
    reply_markup: {
      inline_keyboard: [[
        { text: '🇺🇸 English', callback_data: 'lang_en' },
        { text: '🇷🇺 Русский', callback_data: 'lang_ru' }
      ]]
    }
  });
});

// History command
bot.onText(/\/history/, async (msg) => {
  const chatId = msg.chat.id;
  const userLang = msg.from.language_code || 'en';
  const history = routeHistory.get(chatId) || [];

  if (history.length === 0) {
    const message = userLang === 'ru'
      ? '📁 У вас пока нет сохраненных маршрутов.\n\nОтправьте GPX или KML файл для создания видео.'
      : '📁 You have no saved routes yet.\n\nSend a GPX or KML file to create a video.';
    bot.sendMessage(chatId, message);
    return;
  }

  const message = userLang === 'ru'
    ? `📁 *Ваши последние маршруты:*\n\n`
    : `📁 *Your recent routes:*\n\n`;

  const buttons = history.slice(0, 5).map((route, index) => {
    const date = new Date(route.timestamp);
    const dateStr = date.toLocaleDateString(userLang === 'ru' ? 'ru-RU' : 'en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    const sizeMB = (route.fileSize / 1024 / 1024).toFixed(1);

    return [{
      text: `${index + 1}. ${route.fileName} (${sizeMB}MB) - ${dateStr}`,
      callback_data: `rerender_${index}`
    }];
  });

  bot.sendMessage(chatId, message, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: buttons
    }
  });
});

// Status command
bot.onText(/\/status/, async (msg) => {
  const chatId = msg.chat.id;
  const userLang = msg.from.language_code || 'en';
  const renders = activeRenders.get(chatId);

  if (!renders || (Array.isArray(renders) ? renders.length === 0 : !renders)) {
    bot.sendMessage(chatId, t(chatId, 'status.noActive', {}, userLang));
    return;
  }

  // Handle both old format (single render) and new format (array of renders)
  const renderList = Array.isArray(renders) ? renders : [renders];

  // Filter out completed/failed renders older than 1 hour
  const oneHourAgo = Date.now() - (60 * 60 * 1000);
  const activeRenderList = renderList.filter(r => {
    if ((r.status === 'completed' || r.status === 'failed') && r.completedAt && r.completedAt < oneHourAgo) {
      return false;
    }
    return true;
  });

  if (activeRenderList.length === 0) {
    bot.sendMessage(chatId, t(chatId, 'status.noActive', {}, userLang));
    return;
  }

  // Build status message for all active renders
  let statusMessage = userLang === 'ru'
    ? `📊 **Активные рендеры:** ${activeRenderList.length}\n\n`
    : `📊 **Active renders:** ${activeRenderList.length}\n\n`;

  for (let i = 0; i < activeRenderList.length; i++) {
    const render = activeRenderList[i];
    const renderNum = activeRenderList.length > 1 ? `#${i + 1} ` : '';

    statusMessage += `${renderNum}**${render.fileName || 'Route'}**\n`;
    statusMessage += `📋 ID: \`${render.outputId || 'pending'}\`\n`;

    // Show elapsed time and estimated completion
    if (render.startedAt) {
      const elapsed = Math.floor((Date.now() - render.startedAt) / 1000);
      const minutes = Math.floor(elapsed / 60);
      const seconds = elapsed % 60;
      statusMessage += `⏱️ Elapsed: ${minutes}m ${seconds}s`;

      // Show estimated time remaining if we have it
      if (render.estimatedMinutes) {
        const remaining = Math.max(0, render.estimatedMinutes - (elapsed / 60));
        if (remaining > 0) {
          statusMessage += ` / ~${Math.ceil(remaining)}m remaining`;
        }
      }
      statusMessage += '\n';
    }

    // Show estimated file size if available
    if (render.estimatedSizeMB && render.status !== 'completed') {
      statusMessage += `💾 Est. size: ~${render.estimatedSizeMB}MB\n`;
    }

    // Try to fetch actual progress from logs
    if (render.outputId) {
      try {
        const logsUrl = `${API_SERVER}/logs/${render.outputId}/text`;
        const response = await axios.get(logsUrl, {
          timeout: 5000,
          validateStatus: (status) => status === 200 // Only accept 200, throw on anything else
        });
        const logs = response.data;

        // Parse detailed progress from logs
        const stages = [];
        let currentStage = '';

        if (logs.includes('Video encoding completed')) {
          currentStage = '✅ Complete';
        } else if (logs.includes('Starting video encoding')) {
          currentStage = '🎬 Encoding video';
          // Try to get encoding progress
          const encodingMatch = logs.match(/frame=\s*(\d+)\s+fps=\s*([\d.]+)/);
          if (encodingMatch) {
            const frame = encodingMatch[1];
            const fps = encodingMatch[2];
            currentStage += ` (frame ${frame}, ${fps} fps)`;
          }
        } else if (logs.includes('Recording completed')) {
          currentStage = '📦 Finalizing recording';
        } else if (logs.includes('📹 Frame')) {
          currentStage = '📹 Recording';
          // Check for recording progress - new format: "📹 Frame 90/900 (10.0%) | Animation: 3.0s | Elapsed: 180s | ETA: 1620s"
          const frameMatch = logs.match(/📹 Frame (\d+)\/(\d+) \((\d+\.?\d*)%\)[^|]*\| ETA: (\d+)s/);
          if (frameMatch) {
            const current = parseInt(frameMatch[1]);
            const total = parseInt(frameMatch[2]);
            const percent = parseFloat(frameMatch[3]);
            const etaSeconds = parseInt(frameMatch[4]);
            const etaMinutes = Math.ceil(etaSeconds / 60);
            currentStage += ` ${percent.toFixed(0)}% (${current}/${total})`;

            // Add ETA if it's reasonable (more than 1 minute, less than 10 hours)
            if (etaMinutes > 1 && etaMinutes < 600) {
              statusMessage += `${currentStage}\n⏱️ Est. remaining: ~${etaMinutes} min\n`;
              currentStage = ''; // Already added to message
            }
          } else {
            // Fallback to old format without ETA
            const oldFrameMatch = logs.match(/📹 Frame (\d+)\/(\d+) \((\d+\.?\d*)%\)/);
            if (oldFrameMatch) {
              const current = parseInt(oldFrameMatch[1]);
              const total = parseInt(oldFrameMatch[2]);
              const percent = parseFloat(oldFrameMatch[3]);
              currentStage += ` ${percent.toFixed(0)}% (${current}/${total})`;
            }
          }
        } else if (logs.includes('✅ Test capture successful')) {
          currentStage = '📹 Recording frames';
        } else if (logs.includes('Starting route recording')) {
          currentStage = '📹 Recording';
        } else if (logs.includes('Starting canvas frame capture') || logs.includes('✅ Starting canvas frame capture')) {
          currentStage = '🎬 Starting capture';
        } else if (logs.includes('Waiting for Cesium viewer') || logs.includes('Waiting for CESIUM_ANIMATION_READY')) {
          currentStage = '🌍 Loading globe';
        } else if (logs.includes('Loading Cesium app')) {
          currentStage = '🌍 Loading Cesium';
        } else if (logs.includes('Running recording script')) {
          currentStage = '📝 Starting script';
        } else if (logs.includes('Starting Xvfb')) {
          currentStage = '🖥️ Starting display';
        } else if (logs.includes('Starting Docker container')) {
          currentStage = '🐳 Starting container';
        } else {
          currentStage = '⏳ Initializing';
        }

        statusMessage += `${currentStage}\n`;

        // Show animation speed if available
        const speedMatch = logs.match(/Animation speed: (\d+)x/);
        if (speedMatch) {
          statusMessage += `⚡ Speed: ${speedMatch[1]}x\n`;
        }

        // Show video length estimate if available
        const durationMatch = logs.match(/Expected video length: ~([\d.]+) minutes/);
        if (durationMatch) {
          statusMessage += `📹 Est. video: ${durationMatch[1]} min\n`;
        }

      } catch (error) {
        console.log(`Could not fetch logs for ${render.outputId}:`, error.message);
        statusMessage += `${render.status === 'completed' ? '✅' : render.status === 'failed' ? '❌' : '⏳'} ${render.status}\n`;
      }
    } else {
      statusMessage += `⏳ ${render.status || 'pending'}\n`;
    }

    statusMessage += '\n';
  }

  // Add hint for multiple renders
  if (activeRenderList.length > 1) {
    statusMessage += userLang === 'ru'
      ? '💡 Используйте /logs для просмотра логов последнего рендера'
      : '💡 Use /logs to view detailed logs of the latest render';
  }

  try {
    await bot.sendMessage(chatId, statusMessage, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Failed to send status message:', error.message);
    // Try sending without markdown if markdown parsing failed
    try {
      // Remove all markdown formatting characters
      const plainMessage = statusMessage.replace(/[*_`\[\]()~]/g, '').replace(/\\./g, '');
      await bot.sendMessage(chatId, plainMessage);
    } catch (fallbackError) {
      console.error('Failed to send status message even without markdown:', fallbackError.message);
      await bot.sendMessage(chatId, t(chatId, 'errors.unknown', {}, userLang));
    }
  }
});

// Logs command
bot.onText(/\/logs/, async (msg) => {
  const chatId = msg.chat.id;
  const userLang = msg.from.language_code || 'en';
  const renders = activeRenders.get(chatId);

  if (!renders) {
    bot.sendMessage(chatId, t(chatId, 'errors.noLogs', {}, userLang));
    return;
  }

  // Handle both old format (single render) and new format (array of renders)
  const renderList = Array.isArray(renders) ? renders : [renders];
  const latestRender = renderList[renderList.length - 1];

  if (!latestRender || !latestRender.outputId) {
    bot.sendMessage(chatId, t(chatId, 'errors.noLogs', {}, userLang));
    return;
  }

  try {
    await bot.sendMessage(chatId, t(chatId, 'logs.fetching', {}, userLang));

    const logsUrl = `${API_SERVER}/logs/${latestRender.outputId}/text`;
    const response = await axios.get(logsUrl);

    const logs = response.data;

    // Telegram has a 4096 character limit per message
    if (logs.length <= 4096) {
      await bot.sendMessage(chatId, `\`\`\`\n${logs}\n\`\`\``, { parse_mode: 'Markdown' });
    } else {
      // Split into chunks or send as file
      const tempLogFile = path.join(__dirname, 'temp', `logs-${latestRender.outputId}.txt`);
      fs.mkdirSync(path.dirname(tempLogFile), { recursive: true });
      fs.writeFileSync(tempLogFile, logs);

      await bot.sendDocument(chatId, tempLogFile, {}, {
        filename: `logs-${latestRender.outputId}.txt`,
        contentType: 'text/plain'
      });

      // Cleanup
      try { fs.unlinkSync(tempLogFile); } catch (e) { /* ignore */ }
    }
  } catch (error) {
    console.error('Error fetching logs:', error);
    await bot.sendMessage(chatId,
      t(chatId, 'errors.logsFailed', {}, userLang) + '\n' +
      (error.response?.status === 404 ? t(chatId, 'errors.logsNotFound', {}, userLang) : error.message)
    );
  }
});

// Callback query handler for inline keyboard buttons
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;
  const userLang = query.from.language_code || 'en';

  // Handle language change
  if (data.startsWith('lang_')) {
    const newLang = data.substring(5); // Remove 'lang_' prefix
    if (setUserLanguage(chatId, newLang)) {
      await bot.answerCallbackQuery(query.id, {
        text: newLang === 'ru' ? '✅ Язык изменён на Русский' : '✅ Language changed to English',
        show_alert: false
      });
      await bot.sendMessage(chatId, t(chatId, 'language.changed', {}, newLang));
    }
    return;
  }

  // Handle re-render from history
  if (data.startsWith('rerender_')) {
    const index = parseInt(data.substring(9));
    const history = routeHistory.get(chatId) || [];
    const route = history[index];

    if (!route) {
      await bot.answerCallbackQuery(query.id, {
        text: userLang === 'ru' ? '❌ Маршрут не найден' : '❌ Route not found',
        show_alert: true
      });
      return;
    }

    await bot.answerCallbackQuery(query.id, {
      text: userLang === 'ru' ? '🔄 Начинаю повторный рендер...' : '🔄 Starting re-render...',
      show_alert: false
    });

    // Check if original file still exists
    if (!fs.existsSync(route.filePath)) {
      await bot.sendMessage(chatId, userLang === 'ru'
        ? `❌ Файл "${route.fileName}" больше недоступен. Пожалуйста, отправьте его снова.`
        : `❌ File "${route.fileName}" is no longer available. Please send it again.`
      );
      return;
    }

    // Send the stored file back for re-processing
    await bot.sendMessage(chatId, userLang === 'ru'
      ? `🔄 Повторный рендер: ${route.fileName}`
      : `🔄 Re-rendering: ${route.fileName}`
    );

    // Trigger file processing by sending as document
    try {
      await bot.sendDocument(chatId, route.filePath);
    } catch (error) {
      console.error('Error re-sending file:', error);
      await bot.sendMessage(chatId, userLang === 'ru'
        ? `❌ Не удалось загрузить файл. Пожалуйста, отправьте "${route.fileName}" снова.`
        : `❌ Failed to load file. Please send "${route.fileName}" again.`
      );
    }
    return;
  }

  // Handle "View Logs" button
  if (data.startsWith('logs_')) {
    const outputId = data.substring(5); // Remove 'logs_' prefix

    try {
      await bot.answerCallbackQuery(query.id, { text: t(chatId, 'logs.fetching', {}, userLang) });

      const logsUrl = `${API_SERVER}/logs/${outputId}/text`;
      const response = await axios.get(logsUrl);

      const logs = response.data;

      // Telegram has a 4096 character limit per message
      if (logs.length <= 4096) {
        await bot.sendMessage(chatId, t(chatId, 'logs.title', { outputId }, userLang) + `\n\n\`\`\`\n${logs}\n\`\`\``, {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[
              { text: t(chatId, 'buttons.refreshLogs', {}, userLang), callback_data: `logs_${outputId}` }
            ]]
          }
        });
      } else {
        // Split into chunks or send as file
        const tempLogFile = path.join(__dirname, 'temp', `logs-${outputId}.txt`);
        fs.mkdirSync(path.dirname(tempLogFile), { recursive: true });
        fs.writeFileSync(tempLogFile, logs);

        await bot.sendDocument(chatId, tempLogFile, {
          caption: t(chatId, 'logs.full', { outputId }, userLang),
          reply_markup: {
            inline_keyboard: [[
              { text: t(chatId, 'buttons.refreshLogs', {}, userLang), callback_data: `logs_${outputId}` }
            ]]
          }
        }, {
          filename: `logs-${outputId}.txt`,
          contentType: 'text/plain'
        });

        // Cleanup
        try { fs.unlinkSync(tempLogFile); } catch (e) { /* ignore */ }
      }
    } catch (error) {
      console.error('Error fetching logs:', error);

      let errorMessage = t(chatId, 'errors.logsFailed', {}, userLang) + '\n';

      if (error.response?.status === 404) {
        errorMessage += '\n' + t(chatId, 'logs.notAvailable', {}, userLang);
      } else {
        errorMessage += error.message;
      }

      await bot.answerCallbackQuery(query.id, {
        text: getUserLanguage(chatId, userLang) === 'ru' ? '⏳ Логи пока недоступны' : '⏳ Logs not available yet',
        show_alert: false
      });

      await bot.sendMessage(chatId, errorMessage, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: t(chatId, 'buttons.tryAgain', {}, userLang), callback_data: `logs_${outputId}` }
          ]]
        }
      });
    }
  }
});

// Cleanup command - clear old renders
bot.onText(/\/cleanup/, async (msg) => {
  const chatId = msg.chat.id;
  const userLang = msg.from.language_code || 'en';

  try {
    await bot.sendMessage(chatId, t(chatId, 'cleanup.starting', {}, userLang));

    // Call API to get list of output directories
    const outputResponse = await axios.get(`${API_SERVER}/cleanup`, {
      params: { daysOld: 7 } // Delete renders older than 7 days
    });

    const result = outputResponse.data;

    if (result.success) {
      await bot.sendMessage(chatId, t(chatId, 'cleanup.complete', {
        deleted: result.deletedCount,
        space: (result.freedSpaceMB || 0).toFixed(2),
        remaining: result.remainingCount
      }, userLang));
    } else {
      await bot.sendMessage(chatId, t(chatId, 'cleanup.failed', {
        error: result.error || 'Unknown error'
      }, userLang));
    }
  } catch (error) {
    console.error('Error during cleanup:', error);
    await bot.sendMessage(chatId, t(chatId, 'cleanup.error', {
      error: error.response?.data?.error || error.message
    }, userLang));
  }
});

// /queue - Show current queue status
bot.onText(/\/queue/, async (msg) => {
  const chatId = msg.chat.id;
  const userLang = msg.from.language_code || 'en';

  try {
    const queueResponse = await axios.get(`${API_SERVER}/queue/stats`, {
      timeout: 5000
    });

    const stats = queueResponse.data;
    
    let message = userLang === 'ru' ? '📊 Состояние очереди GPU\n\n' : '📊 GPU Queue Status\n\n';
    message += userLang === 'ru' 
      ? `🎬 Активно: ${stats.running}/${stats.maxConcurrent}\n`
      : `🎬 Running: ${stats.running}/${stats.maxConcurrent}\n`;
    message += userLang === 'ru' 
      ? `⏳ В очереди: ${stats.queued}\n`
      : `⏳ Queued: ${stats.queued}\n`;
    message += userLang === 'ru' 
      ? `✅ Завершено: ${stats.completed}\n`
      : `✅ Completed: ${stats.completed}\n`;
    message += userLang === 'ru' 
      ? `❌ Ошибок: ${stats.failed}\n`
      : `❌ Failed: ${stats.failed}\n`;

    if (stats.runningJobs && stats.runningJobs.length > 0) {
      message += userLang === 'ru' ? '\n🎬 Текущие рендеры:\n' : '\n🎬 Current renders:\n';
      stats.runningJobs.forEach((jobId, i) => {
        message += `${i + 1}. ${jobId}\n`;
      });
    }

    if (stats.queuedJobs && stats.queuedJobs.length > 0) {
      message += userLang === 'ru' ? '\n⏳ Очередь:\n' : '\n⏳ Queue:\n';
      stats.queuedJobs.slice(0, 5).forEach((job, i) => {
        const waitMinutes = Math.ceil((Date.now() - job.addedAt) / 60000);
        message += `${i + 1}. ${job.id} (${waitMinutes}m)\n`;
      });
      if (stats.queuedJobs.length > 5) {
        message += userLang === 'ru' 
          ? `... и ещё ${stats.queuedJobs.length - 5}\n`
          : `... and ${stats.queuedJobs.length - 5} more\n`;
      }
    }

    await bot.sendMessage(chatId, message);
  } catch (error) {
    console.error('Error fetching queue stats:', error);
    const errorMsg = userLang === 'ru' 
      ? '❌ Ошибка при получении статуса очереди'
      : '❌ Error fetching queue status';
    await bot.sendMessage(chatId, errorMsg);
  }
});

// Handle document (GPX file)
bot.on('document', async (msg) => {
  const chatId = msg.chat.id;
  const doc = msg.document;
  const userLang = msg.from.language_code || 'en';

  // Check if it's a GPX or KML file
  const fileName = doc.file_name.toLowerCase();
  const isGPX = fileName.endsWith('.gpx');
  const isKML = fileName.endsWith('.kml');

  if (!isGPX && !isKML) {
    bot.sendMessage(chatId, t(chatId, 'errors.notGpx', {}, userLang));
    return;
  }

  const fileType = isKML ? 'KML' : 'GPX';
  console.log(`Processing ${fileType} file: ${fileName}`);

  try {
    // Send initial message
    await bot.sendMessage(chatId, t(chatId, 'processing.downloading', {}, userLang));

    // Download the file
    const file = await bot.getFile(doc.file_id);
    const filePath = file.file_path;
    const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;

    const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });
    const fileBuffer = Buffer.from(response.data);

    // Save temporarily with correct extension
    const fileExt = isKML ? '.kml' : '.gpx';
    const tempPath = path.join(__dirname, 'temp', `${Date.now()}${fileExt}`);
    fs.mkdirSync(path.dirname(tempPath), { recursive: true });
    fs.writeFileSync(tempPath, fileBuffer);

    // Analyze file and show analytics
    await bot.sendMessage(chatId, t(chatId, 'processing.analyzing', {}, userLang));

    const fileContent = fileBuffer.toString('utf8');
    const analysis = isGPX ? analyzeGPX(fileContent) : analyzeKML(fileContent);

    if (analysis.success) {
      // Send analytics to user (with language support)
      const lang = getUserLanguage(chatId, userLang);
      const analyticsMessage = formatAnalytics(analysis, lang);
      await bot.sendMessage(chatId, analyticsMessage, { parse_mode: 'Markdown' });
    } else {
      const errorMsg = getUserLanguage(chatId, userLang) === 'ru'
        ? `⚠️ Не удалось проанализировать GPX: ${analysis.error}`
        : `⚠️ Could not analyze GPX: ${analysis.error}`;
      await bot.sendMessage(chatId, errorMsg);
    }

    // Calculate render time estimation based on analysis
    let estimatedRenderMinutes = null;
    let estimatedSizeMB = null;
    let animationSpeed = 10;

    if (analysis.success && analysis.statistics.duration) {
      const routeDurationMinutes = analysis.statistics.duration.minutes;

      // Calculate adaptive animation speed (same logic as server)
      const MAX_VIDEO_MINUTES = 10; // Increased for slower animation
      const requiredSpeed = Math.ceil(routeDurationMinutes / (MAX_VIDEO_MINUTES - 0.5));

      if (requiredSpeed > 10) {
        animationSpeed = requiredSpeed;
      }

      // Estimate render time (GPU-accelerated rendering with 90 FPS)
      // Recording duration in seconds
      const recordingSeconds = (routeDurationMinutes * 60 / animationSpeed) + 19;
      const recordingMinutes = recordingSeconds / 60;
      const totalFrames = Math.ceil(recordingSeconds * 90); // 90 FPS

      // GPU rendering is very fast - real-time or better
      // Recording happens at actual playback speed (1x) or slightly slower
      // Add 20% buffer for terrain loading and high-quality graphics
      const captureMinutes = recordingMinutes * 1.2;

      // Encoding happens in parallel and is hardware accelerated
      // With GPU encoding, it's roughly 1:1 with recording time
      const encodingMinutes = recordingMinutes * 1.0;

      // Total with overhead
      const overheadMinutes = 1; // Startup time (faster with GPU)
      estimatedRenderMinutes = Math.ceil(captureMinutes + encodingMinutes + overheadMinutes);

      // Estimate file size based on CRF 18, 8000k bitrate, 90 FPS
      // High quality 1920x1080 at 90 FPS produces ~2-2.5 MB/minute
      estimatedSizeMB = Math.ceil(recordingMinutes * 2.3);

      const lang = getUserLanguage(chatId, userLang);
      let statusMsg = t(chatId, 'estimation.title', {}, userLang) + '\n\n';
      statusMsg += t(chatId, 'estimation.speed', { speed: animationSpeed }, userLang) + '\n';
      statusMsg += t(chatId, 'estimation.videoLength', { length: recordingMinutes.toFixed(1) }, userLang) + '\n';
      statusMsg += t(chatId, 'estimation.size', { size: estimatedSizeMB }, userLang) + '\n';
      statusMsg += t(chatId, 'estimation.time', { time: estimatedRenderMinutes }, userLang) + '\n\n';

      if (estimatedSizeMB > 50) {
        statusMsg += t(chatId, 'estimation.tooLarge', {}, userLang) + '\n\n';
      }

      statusMsg += t(chatId, 'estimation.starting', {}, userLang);

      await bot.sendMessage(chatId, statusMsg);
    } else {
      // No duration available, can't estimate
      await bot.sendMessage(chatId, t(chatId, 'estimation.default', {}, userLang));
    }

    // Submit to render API
    const formData = new FormData();
    formData.append('gpx', fs.createReadStream(tempPath));

    // Generate outputId immediately and send it to the server
    const outputId = `render-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    formData.append('outputId', outputId);

    // Pass user's display name for personalization
    const userName = msg.from.username || msg.from.first_name || 'Hiker';
    formData.append('userName', userName);

    await bot.sendMessage(chatId,
      t(chatId, 'processing.starting', { outputId }, userLang),
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: t(chatId, 'buttons.viewLogs', {}, userLang), callback_data: `logs_${outputId}` }
          ]]
        }
      }
    );

    // Track this render (add to array to support multiple concurrent renders)
    const existingRenders = activeRenders.get(chatId) || [];
    const rendersList = Array.isArray(existingRenders) ? existingRenders : [existingRenders];
    rendersList.push({
      status: 'rendering',
      outputId: outputId,
      fileName: doc.file_name,
      startedAt: Date.now(),
      estimatedMinutes: estimatedRenderMinutes,
      estimatedSizeMB: estimatedSizeMB
    });
    activeRenders.set(chatId, rendersList);

    // Check queue status and inform user
    let queueCheckAttempts = 0;
    const queueCheckInterval = setInterval(async () => {
      try {
        queueCheckAttempts++;
        const statusResponse = await axios.get(`${API_SERVER}/status/${outputId}`, {
          timeout: 5000,
          validateStatus: () => true
        });

        if (statusResponse.status === 200 && statusResponse.data.status === 'queued') {
          const { position, queueLength, estimatedWaitTime } = statusResponse.data;
          const waitMinutes = Math.ceil(estimatedWaitTime / 60);
          
          const queueMsg = userLang === 'ru' 
            ? `⏳ Ваш рендер в очереди\n📍 Позиция: ${position} из ${queueLength}\n⏱ Ожидание: ~${waitMinutes} мин`
            : `⏳ Your render is queued\n📍 Position: ${position} of ${queueLength}\n⏱ Estimated wait: ~${waitMinutes} min`;
          
          await bot.sendMessage(chatId, queueMsg);
          clearInterval(queueCheckInterval);
        } else if (statusResponse.status === 200 && statusResponse.data.status === 'processing') {
          const startMsg = userLang === 'ru' 
            ? `🚀 Рендеринг начался!`
            : `🚀 Rendering started!`;
          await bot.sendMessage(chatId, startMsg);
          clearInterval(queueCheckInterval);
        }

        // Stop checking after 30 seconds
        if (queueCheckAttempts > 30) {
          clearInterval(queueCheckInterval);
        }
      } catch (err) {
        console.log('Queue check error:', err.message);
      }
    }, 1000); // Check every second for first 30 seconds

    // Start progress monitoring (sends updates based on log content)
    let lastLogLength = 0;
    let lastProgressMessage = '';
    let progressStage = 'starting';

    const progressInterval = setInterval(async () => {
      try {
        const logsResponse = await axios.get(`${API_SERVER}/logs/${outputId}/text`, {
          timeout: 5000,
          validateStatus: () => true
        });

        if (logsResponse.status === 200 && logsResponse.data) {
          const logs = logsResponse.data;

          // Only process if logs have grown
          if (logs.length > lastLogLength + 100) {
            lastLogLength = logs.length;

            // Detect current stage from logs
            let newStage = progressStage;
            let statusMessage = '';

            if (logs.includes('Recording process complete')) {
              newStage = 'finalizing';
              statusMessage = t(chatId, 'processing.finalizing', {}, userLang);
            } else if (logs.includes('Video encoding complete')) {
              newStage = 'encoding-done';
              statusMessage = t(chatId, 'processing.encodingDone', {}, userLang);
            } else if (logs.includes('Starting video encoding')) {
              newStage = 'encoding';
              statusMessage = t(chatId, 'processing.encoding', {}, userLang);
            } else if (logs.includes('📹 Frame')) {
              // Extract recording progress - new format: "📹 Frame 90/900 (10.0%)"
              // Use lastIndexOf to get the most recent frame update
              const lastFrameLog = logs.substring(logs.lastIndexOf('📹 Frame'));
              const frameMatch = lastFrameLog.match(/📹 Frame (\d+)\/(\d+) \((\d+\.?\d*)%\)/);
              if (frameMatch) {
                const current = frameMatch[1];
                const total = frameMatch[2];
                const percent = parseFloat(frameMatch[3]).toFixed(0);
                newStage = 'recording';
                statusMessage = t(chatId, 'processing.recording', { percent, current, total }, userLang);
              }
            } else if (logs.includes('✅ Test capture successful') || logs.includes('✅ Starting canvas frame capture')) {
              newStage = 'recording';
              statusMessage = userLang === 'ru' ? '📹 Начинаю запись кадров...' : '📹 Starting frame recording...';
            } else if (logs.includes('Recording progress:')) {
              // Old format fallback
              const progressMatch = logs.match(/Recording progress: (\d+)\/(\d+)s \((\d+)%\)/);
              if (progressMatch) {
                const [, current, total, percent] = progressMatch;
                newStage = 'recording';
                statusMessage = t(chatId, 'processing.recording', { percent, current, total }, userLang);
              }
            } else if (logs.includes('Waiting for Cesium viewer to initialize')) {
              newStage = 'loading';
              statusMessage = t(chatId, 'processing.loading', {}, userLang);
            } else if (logs.includes('Loading Cesium app:') || logs.includes('Cesium app loaded')) {
              newStage = 'initializing';
              statusMessage = t(chatId, 'processing.initializing', {}, userLang);
            } else if (logs.includes('Starting canvas frame capture')) {
              newStage = 'ready';
              statusMessage = '🎬 Animation ready, starting capture...';
            } else if (logs.includes('Starting Docker container')) {
              newStage = 'docker';
              statusMessage = t(chatId, 'processing.docker', {}, userLang);
            }

            // Only send update if stage changed or it's a recording progress update
            if (statusMessage && (newStage !== progressStage || statusMessage !== lastProgressMessage)) {
              progressStage = newStage;
              lastProgressMessage = statusMessage;

              await bot.sendMessage(chatId, statusMessage, {
                reply_markup: {
                  inline_keyboard: [[
                    { text: t(chatId, 'buttons.viewFullLogs', {}, userLang), callback_data: `logs_${outputId}` }
                  ]]
                }
              }).catch(err => console.warn('Failed to send progress update:', err.message));
            }
          }
        }
      } catch (err) {
        // Silently ignore errors (logs might not be available yet)
        console.log('Progress check:', err.message);
      }
    }, 20000); // Check every 20 seconds (was 2 minutes)

    let renderResponse;
    try {
      renderResponse = await axios.post(`${API_SERVER}/render-route`, formData, {
        headers: formData.getHeaders(),
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        timeout: 3600000, // 60 minute timeout (long routes can take 30-45 minutes)
        validateStatus: () => true // Don't throw on any status code, we'll handle it
      });
    } catch (err) {
      // Surface HTTP / network errors with any response body for easier debugging
      const respData = err.response && err.response.data ? err.response.data : null;
      console.error('Render API request failed:', err.message, respData || 'no response body');

      // Check if it's a timeout
      if (err.code === 'ECONNABORTED' || err.message.includes('timeout')) {
        throw new Error('Render timed out after 60 minutes. The route is extremely long. Please try splitting it into shorter segments.');
      }

      throw new Error('Render API request failed: ' + (respData ? JSON.stringify(respData) : err.message));
    } finally {
      // Stop progress monitoring
      clearInterval(progressInterval);
    }

    const result = renderResponse.data;

    console.log('Render API response:', JSON.stringify(result, null, 2));
    console.log('HTTP status:', renderResponse.status);

    // Update status with server's outputId if different, or keep our generated one
    const finalOutputId = (result && result.outputId) ? result.outputId : outputId;

    // Update render status in the array
    const updatedRenders = activeRenders.get(chatId) || [];
    const renderIndex = updatedRenders.findIndex(r => r.outputId === finalOutputId);
    if (renderIndex >= 0) {
      updatedRenders[renderIndex] = {
        ...updatedRenders[renderIndex],
        status: result && result.success ? 'completed' : 'failed',
        videoPath: result ? result.videoUrl : null,
        completedAt: Date.now()
      };
      activeRenders.set(chatId, updatedRenders);
    }

    // Check for non-2xx status codes
    if (renderResponse.status !== 200 && renderResponse.status !== 201) {
      console.error('Render API returned error status:', renderResponse.status);
      const errorMsg = result && (result.error || result.details) ? (result.error || result.details) : JSON.stringify(result);
      throw new Error(`Render failed (HTTP ${renderResponse.status}): ${errorMsg}`);
    }

    if (!result || !result.success) {
      console.error('Render API returned unsuccessful response:', result);
      const details = result && (result.error || result.details) ? (result.error || result.details) : JSON.stringify(result);
      throw new Error('Render failed: ' + details);
    }

    // Status was already updated above in the array, no need to overwrite here
    // (Removed the overwrite that was breaking multiple renders support)

    await bot.sendMessage(chatId, t(chatId, 'processing.complete', {
      size: (result.fileSize / 1024 / 1024).toFixed(2)
    }, userLang));

    // Send the video
    // Try multiple path resolutions
    let videoPath = path.join(__dirname, '..', result.videoUrl.substring(1)); // Remove leading /

    // If not found, try resolving from output directory
    if (!fs.existsSync(videoPath)) {
      videoPath = path.join(__dirname, '../output', result.outputId, 'route-video.mp4');
    }

    console.log('Looking for video at:', videoPath);
    console.log('Video exists:', fs.existsSync(videoPath));

    if (fs.existsSync(videoPath)) {
      console.log('Sending video to chat:', chatId);

      const fileSizeMB = result.fileSize / 1024 / 1024;
      const TELEGRAM_MAX_SIZE_MB = 50; // Telegram's limit for bots

      // Check if file is too large for Telegram
      if (fileSizeMB > TELEGRAM_MAX_SIZE_MB) {
        console.warn(`Video is too large (${fileSizeMB.toFixed(2)}MB). Telegram limit is ${TELEGRAM_MAX_SIZE_MB}MB`);

        await bot.sendMessage(chatId, t(chatId, 'fileSize.tooLarge', {
          size: fileSizeMB.toFixed(2),
          limit: TELEGRAM_MAX_SIZE_MB,
          url: `${PUBLIC_URL}${result.videoUrl}`
        }, userLang));
      } else {
        // File is within limits, send normally
        try {
          await bot.sendVideo(chatId, videoPath, {
            caption: t(chatId, 'videoCaption', {
              filename: doc.file_name,
              size: fileSizeMB.toFixed(2)
            }, userLang),
            supports_streaming: true
          });

          await bot.sendMessage(chatId, t(chatId, 'processing.done', {}, userLang), {
            reply_markup: {
              inline_keyboard: [[
                { text: t(chatId, 'buttons.viewLogs', {}, userLang), callback_data: `logs_${finalOutputId}` }
              ]]
            }
          });

          // Add to route history after successful video send
          addRouteToHistory(chatId, doc.file_name, tempPath, result.videoUrl, result.fileSize);
        } catch (telegramError) {
          // Handle Telegram API errors (e.g., file still too large)
          console.error('Error sending video to Telegram:', telegramError.message);

          if (telegramError.message.includes('413') || telegramError.message.includes('Too Large')) {
            await bot.sendMessage(chatId, t(chatId, 'fileSize.rejected', {
              size: fileSizeMB.toFixed(2),
              url: `${PUBLIC_URL}${result.videoUrl}`
            }, userLang));
          } else {
            throw telegramError; // Re-throw if it's a different error
          }
        }
      }
    } else {
      // Log available info for debugging
      console.error('Video file not found!');
      console.error('Expected path:', videoPath);
      console.error('Result data:', JSON.stringify(result, null, 2));

      // Try to list output directory to help debug
      const outputDir = path.join(__dirname, '../output', result.outputId);
      if (fs.existsSync(outputDir)) {
        console.error('Output directory exists. Contents:', fs.readdirSync(outputDir));
      } else {
        console.error('Output directory does not exist:', outputDir);
      }

      throw new Error(`Video file not found at: ${videoPath}`);
    }

    // Cleanup temp file
    fs.unlinkSync(tempPath);

    // Remove completed render from activeRenders after successful completion
    const completedRenders = activeRenders.get(chatId) || [];
    const updatedCompletedRenders = Array.isArray(completedRenders)
      ? completedRenders.filter(r => r.outputId !== finalOutputId)
      : [];
    if (updatedCompletedRenders.length > 0) {
      activeRenders.set(chatId, updatedCompletedRenders);
    } else {
      activeRenders.delete(chatId);
    }

  } catch (error) {
    console.error('Error processing GPX:', error);

    // Get the render info if available - handle both array and single render
    const renders = activeRenders.get(chatId);
    const renderList = Array.isArray(renders) ? renders : (renders ? [renders] : []);
    const render = renderList[renderList.length - 1]; // Get the latest render

    // Mark failed render and clean up from activeRenders
    if (render && render.outputId) {
      const updatedFailedRenders = renderList.filter(r => r.outputId !== render.outputId);
      if (updatedFailedRenders.length > 0) {
        activeRenders.set(chatId, updatedFailedRenders);
      } else {
        activeRenders.delete(chatId);
      }
    }

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
          t(chatId, 'errors.processing', { error: detailText }, userLang) +
          (render && render.outputId ? `\n\n📋 Render ID: \`${render.outputId}\`` : ''),
          {
            parse_mode: 'Markdown',
            reply_markup: render && render.outputId ? {
              inline_keyboard: [[
                { text: t(chatId, 'buttons.viewFullLogs', {}, userLang), callback_data: `logs_${render.outputId}` }
              ]]
            } : undefined
          }
        );
      } else {
        // Write the long error to a temporary file and send as a document
        const errFileDir = path.join(__dirname, 'temp');
        fs.mkdirSync(errFileDir, { recursive: true });
        const errFilePath = path.join(errFileDir, `render-error-${Date.now()}.txt`);
        fs.writeFileSync(errFilePath, detailText);

        await bot.sendMessage(chatId,
          t(chatId, 'errors.processingLong', {}, userLang) +
          (render && render.outputId ? `\n\n📋 Render ID: \`${render.outputId}\`` : ''),
          {
            parse_mode: 'Markdown',
            reply_markup: render && render.outputId ? {
              inline_keyboard: [[
                { text: t(chatId, 'buttons.viewFullLogs', {}, userLang), callback_data: `logs_${render.outputId}` }
              ]]
            } : undefined
          }
        );

        await bot.sendDocument(chatId, errFilePath, {
          reply_markup: render && render.outputId ? {
            inline_keyboard: [[
              { text: t(chatId, 'buttons.viewServerLogs', {}, userLang), callback_data: `logs_${render.outputId}` }
            ]]
          } : undefined
        }, { filename: 'render-error.txt' });

        // Cleanup
        try { fs.unlinkSync(errFilePath); } catch (e) { /* ignore */ }
      }

      // If we have an outputId, offer to send detailed logs
      if (render && render.outputId) {
        await bot.sendMessage(chatId, t(chatId, 'logs.available', {}, userLang));
      }
    } catch (sendErr) {
      // If sending the message/document fails, ensure we still log it to server console
      console.error('Failed to notify user via Telegram:', sendErr);
    }

    // Mark the failed render in the array instead of deleting all renders
    if (render && render.outputId) {
      const updatedRenders = activeRenders.get(chatId) || [];
      const renderIndex = updatedRenders.findIndex(r => r.outputId === render.outputId);
      if (renderIndex >= 0) {
        updatedRenders[renderIndex] = {
          ...updatedRenders[renderIndex],
          status: 'failed',
          completedAt: Date.now()
        };
        activeRenders.set(chatId, updatedRenders);
      }
    }
  }
});

// Handle other messages
bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const userLang = msg.from.language_code || 'en';

  // Ignore commands and documents (handled separately)
  if (msg.text && msg.text.startsWith('/')) return;
  if (msg.document) return;

  bot.sendMessage(chatId, t(chatId, 'errors.unknown', {}, userLang));
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
