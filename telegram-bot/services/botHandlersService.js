const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { analyzeGPX, analyzeKML, formatAnalytics } = require('../gpxAnalyzer');
const { getUserLanguage, setUserLanguage, t, formatMessage } = require('../i18n');
const CONSTANTS = require('../../config/constants.cjs');
const renderingConfig = require('../../config/rendering.cjs');

// Get version at startup
const versionInfo = renderingConfig.getVersionInfo();

/**
 * Bot Handlers Service
 *
 * Handles all Telegram bot command and event handlers:
 * - Commands: /start, /help, /language, /history, /status, /logs, /cleanup
 * - File uploads: GPX/KML document processing
 * - Callback queries: Inline buttons and interactions
 *
 * Separates handler logic from bot initialization.
 */
class BotHandlersService {
  constructor(bot, apiService, stateService, botToken) {
    this.bot = bot;
    this.api = apiService;
    this.state = stateService;
    this.botToken = botToken;

    // Track progress monitoring intervals
    this.progressIntervals = new Map(); // outputId -> intervalId
  }

  /**
   * Register all bot handlers
   */
  registerHandlers() {
    this.registerCommandHandlers();
    this.registerFileHandler();
    this.registerCallbackHandler();
    console.log('✅ Bot handlers registered');
  }

  /**
   * Register command handlers
   */
  registerCommandHandlers() {
    // /start
    this.bot.onText(/\/start/, (msg) => this.handleStart(msg));

    // /help
    this.bot.onText(/\/help/, (msg) => this.handleHelp(msg));

    // /version
    this.bot.onText(/\/version/, (msg) => this.handleVersion(msg));

    // /language
    this.bot.onText(/\/language/, (msg) => this.handleLanguage(msg));

    // /history
    this.bot.onText(/\/history/, (msg) => this.handleHistory(msg));

    // /status
    this.bot.onText(/\/status/, (msg) => this.handleStatus(msg));

    // /logs <outputId>
    this.bot.onText(/\/logs (.+)/, (msg, match) => this.handleLogs(msg, match));

    // /cleanup
    this.bot.onText(/\/cleanup/, (msg) => this.handleCleanup(msg));
  }

  /**
   * Register file upload handler
   */
  registerFileHandler() {
    this.bot.on('document', (msg) => this.handleDocument(msg));
  }

  /**
   * Register callback query handler
   */
  registerCallbackHandler() {
    this.bot.on('callback_query', (query) => this.handleCallback(query));
  }

  /**
   * Handle /start command
   */
  async handleStart(msg) {
    const chatId = msg.chat.id;
    const userLang = msg.from.language_code || 'en';
    let message = formatMessage(chatId, 'welcome', {}, userLang);

    // Add version info
    const versionLine = userLang === 'ru'
      ? `\n\n📦 Версия: ${versionInfo.version} (${versionInfo.commit})`
      : `\n\n📦 Version: ${versionInfo.version} (${versionInfo.commit})`;
    message += versionLine;

    await this.bot.sendMessage(chatId, message);
  }

  /**
   * Handle /help command
   */
  async handleHelp(msg) {
    const chatId = msg.chat.id;
    const userLang = msg.from.language_code || 'en';
    const message = formatMessage(chatId, 'help', {}, userLang);
    await this.bot.sendMessage(chatId, message);
  }

  /**
   * Handle /version command
   */
  async handleVersion(msg) {
    const chatId = msg.chat.id;
    const userLang = msg.from.language_code || 'en';

    const message = userLang === 'ru'
      ? `📦 **Cesium Route Renderer**\n\n` +
        `🏷️ Версия: ${versionInfo.version}\n` +
        `🔗 Коммит: ${versionInfo.commit}\n` +
        `📅 Сборка: ${versionInfo.buildDate}\n\n` +
        `⚙️ Конфигурация:\n` +
        `• FPS: 24\n` +
        `• Разрешение: 720×1280\n` +
        `• Макс. скорость: ${CONSTANTS.ANIMATION.MAX_SPEED}x`
      : `📦 **Cesium Route Renderer**\n\n` +
        `🏷️ Version: ${versionInfo.version}\n` +
        `🔗 Commit: ${versionInfo.commit}\n` +
        `📅 Build: ${versionInfo.buildDate}\n\n` +
        `⚙️ Configuration:\n` +
        `• FPS: 24\n` +
        `• Resolution: 720×1280\n` +
        `• Max speed: ${CONSTANTS.ANIMATION.MAX_SPEED}x`;

    await this.bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  }

  /**
   * Handle /language command
   */
  async handleLanguage(msg) {
    const chatId = msg.chat.id;
    const userLang = msg.from.language_code || 'en';

    await this.bot.sendMessage(chatId, t(chatId, 'language.select', {}, userLang), {
      reply_markup: {
        inline_keyboard: [[
          { text: '🇺🇸 English', callback_data: 'lang_en' },
          { text: '🇷🇺 Русский', callback_data: 'lang_ru' }
        ]]
      }
    });
  }

  /**
   * Handle /history command
   */
  async handleHistory(msg) {
    const chatId = msg.chat.id;
    const userLang = msg.from.language_code || 'en';
    const history = this.state.getHistory(chatId);

    if (history.length === 0) {
      const message = userLang === 'ru'
        ? '📁 У вас пока нет сохраненных маршрутов.\n\nОтправьте GPX или KML файл для создания видео.'
        : '📁 You have no saved routes yet.\n\nSend a GPX or KML file to create a video.';
      await this.bot.sendMessage(chatId, message);
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

      return [{
        text: `${index + 1}. ${route.fileName} - ${dateStr}`,
        callback_data: `rerender_${index}`
      }];
    });

    await this.bot.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: buttons
      }
    });
  }

  /**
   * Handle /status command
   */
  async handleStatus(msg) {
    const chatId = msg.chat.id;
    const userLang = msg.from.language_code || 'en';
    const activeRender = this.state.getActiveRender(chatId);

    if (!activeRender) {
      const noActiveMsg = userLang === 'ru'
        ? `❌ Нет активных рендеров. Отправьте GPX файл!\n\n📦 v${versionInfo.version} (${versionInfo.commit})`
        : `❌ No active renders. Send me a GPX file to start!\n\n📦 v${versionInfo.version} (${versionInfo.commit})`;
      await this.bot.sendMessage(chatId, noActiveMsg);
      return;
    }

    // Build status message
    let statusMessage = userLang === 'ru' ? '📊 **Статус рендера**\n\n' : '📊 **Render Status**\n\n';
    statusMessage += `**${activeRender.fileName}**\n`;
    statusMessage += `📋 ID: \`${activeRender.outputId}\`\n`;

    // Elapsed time
    if (activeRender.startTime) {
      const elapsed = Math.floor((Date.now() - activeRender.startTime) / 1000);
      const minutes = Math.floor(elapsed / 60);
      const seconds = elapsed % 60;
      statusMessage += userLang === 'ru'
        ? `⏱️ Прошло: ${minutes}м ${seconds}с\n`
        : `⏱️ Elapsed: ${minutes}m ${seconds}s\n`;
    }

    statusMessage += `\n${userLang === 'ru' ? 'Используйте' : 'Use'} /logs ${activeRender.outputId} ${userLang === 'ru' ? 'для просмотра логов' : 'to view logs'}`;

    await this.bot.sendMessage(chatId, statusMessage, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          { text: t(chatId, 'buttons.viewLogs', {}, userLang), callback_data: `logs_${activeRender.outputId}` }
        ]]
      }
    });
  }

  /**
   * Handle /logs command
   */
  async handleLogs(msg, match) {
    const chatId = msg.chat.id;
    const userLang = msg.from.language_code || 'en';
    const outputId = match[1].trim();

    const result = await this.api.getLogsText(outputId);

    if (!result.success) {
      const errorMsg = userLang === 'ru'
        ? `❌ Не удалось получить логи: ${result.error}`
        : `❌ Failed to get logs: ${result.error}`;
      await this.bot.sendMessage(chatId, errorMsg);
      return;
    }

    const logs = result.text;
    const chunks = this.splitMessage(logs, 4000);

    for (let i = 0; i < chunks.length; i++) {
      await this.bot.sendMessage(chatId, `\`\`\`\n${chunks[i]}\n\`\`\``, {
        parse_mode: 'Markdown'
      });
    }
  }

  /**
   * Handle /cleanup command
   */
  async handleCleanup(msg) {
    const chatId = msg.chat.id;
    const userLang = msg.from.language_code || 'en';

    await this.bot.sendMessage(chatId, userLang === 'ru' ? '🗑️ Запускаю очистку...' : '🗑️ Running cleanup...');

    const result = await this.api.runCleanup(7);

    if (result.success) {
      const { deletedFolders, freedSpaceMB } = result.data;
      const message = userLang === 'ru'
        ? `✅ Очистка завершена!\n\n📁 Удалено папок: ${deletedFolders}\n💾 Освобождено: ${freedSpaceMB.toFixed(2)} MB`
        : `✅ Cleanup complete!\n\n📁 Folders deleted: ${deletedFolders}\n💾 Space freed: ${freedSpaceMB.toFixed(2)} MB`;
      await this.bot.sendMessage(chatId, message);
    } else {
      const errorMsg = userLang === 'ru'
        ? `❌ Ошибка очистки: ${result.error}`
        : `❌ Cleanup failed: ${result.error}`;
      await this.bot.sendMessage(chatId, errorMsg);
    }
  }

  /**
   * Handle document (GPX/KML file) upload
   */
  async handleDocument(msg) {
    const chatId = msg.chat.id;
    const doc = msg.document;
    const userLang = msg.from.language_code || 'en';

    // Check file type
    const fileName = doc.file_name.toLowerCase();
    const isGPX = fileName.endsWith('.gpx');
    const isKML = fileName.endsWith('.kml');

    if (!isGPX && !isKML) {
      await this.bot.sendMessage(chatId, t(chatId, 'errors.notGpx', {}, userLang));
      return;
    }

    try {
      await this.bot.sendMessage(chatId, t(chatId, 'processing.downloading', {}, userLang));

      // Download file
      const file = await this.bot.getFile(doc.file_id);
      const filePath = file.file_path;
      const fileUrl = `https://api.telegram.org/file/bot${this.botToken}/${filePath}`;

      const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });
      const fileBuffer = Buffer.from(response.data);

      // Analyze file
      await this.bot.sendMessage(chatId, t(chatId, 'processing.analyzing', {}, userLang));

      const fileContent = fileBuffer.toString('utf8');
      const analysis = isGPX ? analyzeGPX(fileContent) : analyzeKML(fileContent);

      if (analysis.success) {
        const lang = getUserLanguage(chatId, userLang);
        const analyticsMessage = formatAnalytics(analysis, lang);
        await this.bot.sendMessage(chatId, analyticsMessage, { parse_mode: 'Markdown' });
      }

      // Estimate render time
      let animationSpeed = CONSTANTS.ANIMATION.DEFAULT_SPEED;
      let estimatedRenderMinutes = null;
      let estimatedSizeMB = null;

      if (analysis.success && analysis.statistics.duration) {
        const routeDurationMinutes = analysis.statistics.duration.minutes;

        // Platform-agnostic: all videos are 40 seconds
        const TARGET_VIDEO_SECONDS = 40;
        const OUTPUT_FPS = 24;
        const TOTAL_FRAMES = TARGET_VIDEO_SECONDS * OUTPUT_FPS; // 960

        // Animation speed is dynamically calculated to fit route into 40 seconds
        animationSpeed = Math.ceil((routeDurationMinutes * 60) / TARGET_VIDEO_SECONDS);

        const estimation = renderingConfig.estimateRenderTime(routeDurationMinutes, animationSpeed);
        if (estimation) {
          estimatedRenderMinutes = estimation.totalMinutes;
          estimatedSizeMB = estimation.estimatedSizeMB;

          const recordingMinutes = TARGET_VIDEO_SECONDS / 60; // Fixed 40 seconds = 0.67 minutes
          let statusMsg = t(chatId, 'estimation.title', {}, userLang) + '\n\n';
          statusMsg += t(chatId, 'estimation.speed', { speed: animationSpeed }, userLang) + '\n';
          statusMsg += t(chatId, 'estimation.videoLength', { length: recordingMinutes.toFixed(1) }, userLang) + '\n';
          statusMsg += userLang === 'ru'
            ? `🎞️ Кадров: ${TOTAL_FRAMES}\n`
            : `🎞️ Frames: ${TOTAL_FRAMES}\n`;
          statusMsg += t(chatId, 'estimation.size', { size: estimatedSizeMB }, userLang) + '\n';
          statusMsg += t(chatId, 'estimation.time', { time: estimatedRenderMinutes }, userLang);

          if (estimatedSizeMB > CONSTANTS.TELEGRAM.MAX_FILE_SIZE_MB) {
            statusMsg += '\n\n' + t(chatId, 'estimation.tooLarge', {}, userLang);
          }

          await this.bot.sendMessage(chatId, statusMsg);
        }
      }

      // Submit render
      const userName = msg.from.username || msg.from.first_name || 'Hiker';
      const outputId = `render-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      const result = await this.api.submitRender(fileBuffer, doc.file_name, userName, outputId);

      if (!result.success) {
        throw new Error(result.error || 'Render submission failed');
      }

      // Track render
      this.state.setActiveRender(chatId, {
        outputId,
        fileName: doc.file_name,
        startTime: Date.now(),
        status: 'rendering'
      });

      // Simple start message without duplicate hints
      const startMsg = userLang === 'ru'
        ? `🚀 Рендер запущен! Прогресс будет отображаться по мере выполнения.`
        : `🚀 Render started! Progress updates will be shown as it runs.`;
      
      await this.bot.sendMessage(chatId, startMsg, {
        reply_markup: {
          inline_keyboard: [[
            { text: t(chatId, 'buttons.viewLogs', {}, userLang), callback_data: `logs_${outputId}` }
          ]]
        }
      });

      // Start progress monitoring
      this.startProgressMonitoring(chatId, outputId, userLang);

    } catch (error) {
      console.error('Document processing error:', error);
      const errorMsg = userLang === 'ru'
        ? `❌ Ошибка обработки: ${error.message}`
        : `❌ Processing error: ${error.message}`;
      await this.bot.sendMessage(chatId, errorMsg);
    }
  }

  /**
   * Handle callback queries (inline buttons)
   */
  async handleCallback(query) {
    const chatId = query.message.chat.id;
    const data = query.data;
    const userLang = query.from.language_code || 'en';

    try {
      // Language selection
      if (data.startsWith('lang_')) {
        const lang = data.split('_')[1];
        setUserLanguage(chatId, lang);
        await this.bot.answerCallbackQuery(query.id, {
          text: lang === 'ru' ? '✅ Язык изменен на русский' : '✅ Language changed to English'
        });
        await this.bot.editMessageText(
          lang === 'ru' ? '✅ Язык изменен на русский' : '✅ Language changed to English',
          {
            chat_id: chatId,
            message_id: query.message.message_id
          }
        );
        return;
      }

      // View logs
      if (data.startsWith('logs_')) {
        const outputId = data.substring(5);
        const result = await this.api.getLogsText(outputId);

        if (result.success) {
          const chunks = this.splitMessage(result.text, 4000);
          for (const chunk of chunks) {
            await this.bot.sendMessage(chatId, `\`\`\`\n${chunk}\n\`\`\``, { parse_mode: 'Markdown' });
          }
        } else {
          await this.bot.sendMessage(chatId, userLang === 'ru' ? '❌ Логи не найдены' : '❌ Logs not found');
        }

        await this.bot.answerCallbackQuery(query.id);
        return;
      }

      // Re-render from history
      if (data.startsWith('rerender_')) {
        const index = parseInt(data.split('_')[1]);
        const history = this.state.getHistory(chatId);

        if (history[index]) {
          const route = history[index];
          await this.bot.sendMessage(chatId, userLang === 'ru'
            ? `🔄 Повторный рендер: ${route.fileName}`
            : `🔄 Re-rendering: ${route.fileName}`);
          // TODO: Implement re-render logic
        }

        await this.bot.answerCallbackQuery(query.id);
        return;
      }

      await this.bot.answerCallbackQuery(query.id);

    } catch (error) {
      console.error('Callback error:', error);
      await this.bot.answerCallbackQuery(query.id, {
        text: userLang === 'ru' ? '❌ Ошибка' : '❌ Error'
      });
    }
  }

  /**
   * Start progress monitoring for a render
   */
  startProgressMonitoring(chatId, outputId, userLang) {
    let lastLogLength = 0;
    let lastReportedPercent = -1; // Start at -1 to report first progress
    let checkCount = 0;
    let hasReportedStart = false;

    const intervalId = setInterval(async () => {
      try {
        checkCount++;
        const result = await this.api.getLogsText(outputId);

        if (!result.success) {
          console.log(`[${outputId}] Log check ${checkCount}: failed to get logs`);
          return;
        }

        const logs = result.text;

        // Check if render completed - multiple possible completion messages
        const isComplete =
          logs.includes('Recording complete!') ||
          logs.includes('🎉 Recording process complete') ||
          logs.includes('✅ Video encoding complete') ||
          logs.includes('Video saved to');

        if (isComplete) {
          console.log(`[${outputId}] Render complete detected!`);
          clearInterval(intervalId);
          this.progressIntervals.delete(outputId);

          // Try to send video file directly
          await this.sendVideoToUser(chatId, outputId, userLang);
          return;
        }

        // Check for fatal errors
        const hasFatalError =
          logs.includes('Recording failed:') ||
          logs.includes('fatal error:') ||
          logs.includes('Docker exited with code');

        if (hasFatalError) {
          console.log(`[${outputId}] Render failed detected!`);
          clearInterval(intervalId);
          this.progressIntervals.delete(outputId);

          const errorMsg = userLang === 'ru'
            ? `❌ Рендер не удался. Используйте /logs ${outputId} для деталей.`
            : `❌ Render failed. Use /logs ${outputId} for details.`;
          await this.bot.sendMessage(chatId, errorMsg);
          this.state.clearActiveRender(chatId);
          return;
        }

        // Parse and report frame progress
        const frameMatch = logs.match(/📹 Frame (\d+)\/(\d+) \((\d+\.?\d*)%\)/g);
        if (frameMatch && frameMatch.length > 0) {
          const lastFrame = frameMatch[frameMatch.length - 1];
          const match = lastFrame.match(/📹 Frame (\d+)\/(\d+) \((\d+\.?\d*)%\)/);
          if (match) {
            const currentFrame = parseInt(match[1]);
            const totalFrames = parseInt(match[2]);
            const percent = Math.floor(parseFloat(match[3]));

            // Extract ETA if available
            const etaMatch = logs.match(/ETA: (\d+)s/g);
            let etaMinutes = null;
            if (etaMatch && etaMatch.length > 0) {
              const lastEta = etaMatch[etaMatch.length - 1];
              const etaSeconds = parseInt(lastEta.match(/ETA: (\d+)s/)[1]);
              etaMinutes = Math.ceil(etaSeconds / 60);
            }

            // Report first progress immediately, then at 10% intervals
            if (!hasReportedStart || percent >= lastReportedPercent + 10) {
              hasReportedStart = true;
              lastReportedPercent = Math.floor(percent / 10) * 10;
              
              let progressMsg = userLang === 'ru'
                ? `📹 Рендеринг: ${percent}% (${currentFrame}/${totalFrames} кадров)`
                : `📹 Rendering: ${percent}% (${currentFrame}/${totalFrames} frames)`;
              
              if (etaMinutes) {
                progressMsg += userLang === 'ru'
                  ? ` | ⏱️ ~${etaMinutes} мин`
                  : ` | ⏱️ ~${etaMinutes} min`;
              }
              
              await this.bot.sendMessage(chatId, progressMsg);
            }
          }
        }

        // Log periodic status
        if (checkCount % 6 === 0) { // Every minute
          console.log(`[${outputId}] Check ${checkCount}: logs length ${logs.length}, lastPercent ${lastReportedPercent}%`);
        }

      } catch (error) {
        console.error(`[${outputId}] Progress monitoring error:`, error.message);
      }
    }, 10000); // Check every 10 seconds

    this.progressIntervals.set(outputId, intervalId);
    console.log(`[${outputId}] Started progress monitoring`);
  }

  /**
   * Send completed video to user
   */
  async sendVideoToUser(chatId, outputId, userLang) {
    try {
      const videoUrl = this.api.getVideoUrl(outputId);

      // First, try to download and send the video
      const axios = require('axios');
      const videoResponse = await axios.get(videoUrl, {
        responseType: 'arraybuffer',
        timeout: 60000
      });

      const videoBuffer = Buffer.from(videoResponse.data);
      const fileSizeMB = (videoBuffer.length / 1024 / 1024).toFixed(2);

      console.log(`[${outputId}] Video downloaded, size: ${fileSizeMB}MB`);

      // Check if video is too large for Telegram (50MB limit)
      if (videoBuffer.length > 50 * 1024 * 1024) {
        const successMsg = userLang === 'ru'
          ? `✅ Видео готово! (${fileSizeMB}MB - слишком большое для Telegram)\n\n📥 Скачать: ${videoUrl}`
          : `✅ Video ready! (${fileSizeMB}MB - too large for Telegram)\n\n📥 Download: ${videoUrl}`;

        await this.bot.sendMessage(chatId, successMsg, {
          reply_markup: {
            inline_keyboard: [[
              { text: userLang === 'ru' ? '📥 Скачать' : '📥 Download', url: videoUrl }
            ]]
          }
        });
      } else {
        // Send video directly
        const successMsg = userLang === 'ru'
          ? `✅ Видео готово! (${fileSizeMB}MB)`
          : `✅ Video ready! (${fileSizeMB}MB)`;

        await this.bot.sendMessage(chatId, successMsg);

        await this.bot.sendVideo(chatId, videoBuffer, {
          caption: userLang === 'ru' ? '🎬 Ваш маршрут' : '🎬 Your route',
          filename: 'route-video.mp4'
        });
      }

      // Add to history
      await this.state.addToHistory(chatId, {
        outputId,
        fileName: this.state.getActiveRender(chatId)?.fileName || 'route',
        videoUrl
      });

      this.state.clearActiveRender(chatId);

    } catch (error) {
      console.error(`[${outputId}] Failed to send video:`, error.message);

      // Fallback to URL
      const videoUrl = this.api.getVideoUrl(outputId);
      const errorMsg = userLang === 'ru'
        ? `✅ Видео готово!\n\n📥 Скачать: ${videoUrl}`
        : `✅ Video ready!\n\n📥 Download: ${videoUrl}`;

      await this.bot.sendMessage(chatId, errorMsg, {
        reply_markup: {
          inline_keyboard: [[
            { text: userLang === 'ru' ? '📥 Скачать' : '📥 Download', url: videoUrl }
          ]]
        }
      });

      this.state.clearActiveRender(chatId);
    }
  }

  /**
   * Extract progress message from logs
   */
  extractProgressMessage(logs, currentStage, userLang, chatId) {
    if (logs.includes('Recording process complete')) {
      return t(chatId, 'processing.finalizing', {}, userLang);
    }
    if (logs.includes('Starting video encoding')) {
      return t(chatId, 'processing.encoding', {}, userLang);
    }
    if (logs.includes('📹 Frame')) {
      const lastFrameLog = logs.substring(logs.lastIndexOf('📹 Frame'));
      const frameMatch = lastFrameLog.match(/📹 Frame (\d+)\/(\d+) \((\d+\.?\d*)%\)/);
      if (frameMatch) {
        const percent = parseFloat(frameMatch[3]).toFixed(0);
        if (percent % 20 === 0) { // Only report every 20%
          return t(chatId, 'processing.recording', { percent }, userLang);
        }
      }
    }
    return currentStage;
  }

  /**
   * Split long message into chunks
   */
  splitMessage(text, maxLength) {
    const chunks = [];
    let current = '';

    const lines = text.split('\n');
    for (const line of lines) {
      if ((current + line).length > maxLength) {
        chunks.push(current);
        current = line + '\n';
      } else {
        current += line + '\n';
      }
    }

    if (current) {
      chunks.push(current);
    }

    return chunks;
  }

  /**
   * Stop all progress monitoring
   */
  stopAllMonitoring() {
    for (const [outputId, intervalId] of this.progressIntervals) {
      clearInterval(intervalId);
    }
    this.progressIntervals.clear();
    console.log('Stopped all progress monitoring');
  }
}

module.exports = BotHandlersService;
