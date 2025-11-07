const TelegramBot = require('node-telegram-bot-api');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { analyzeGPX, formatAnalytics } = require('./gpxAnalyzer');
const { getUserLanguage, setUserLanguage, t, formatMessage } = require('./i18n');

const BOT_TOKEN = '8418496404:AAGLdVNW_Pla_u1bMVfFia-s9klwRsgYZhs';
const API_SERVER = process.env.API_SERVER || 'http://localhost:3000';
const PUBLIC_URL = process.env.PUBLIC_URL || 'http://195.133.27.96:3000'; // Public URL for downloads

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

console.log('🤖 Telegram bot started!');

// Store active renders
const activeRenders = new Map();

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

// Status command
bot.onText(/\/status/, async (msg) => {
  const chatId = msg.chat.id;
  const userLang = msg.from.language_code || 'en';
  const render = activeRenders.get(chatId);

  if (!render) {
    bot.sendMessage(chatId, t(chatId, 'status.noActive', {}, userLang));
    return;
  }

  let statusMessage = `📊 **Output ID:** \`${render.outputId || 'pending'}\`\n`;
  statusMessage += `⏱️ **Status:** ${render.status}\n\n`;

  // Try to fetch actual progress from logs
  if (render.outputId) {
    try {
      const logsUrl = `${API_SERVER}/logs/${render.outputId}/text`;
      const response = await axios.get(logsUrl, { timeout: 5000 });
      const logs = response.data;

      // Parse progress from logs
      if (logs.includes('Starting Docker container')) {
        statusMessage += '🐳 Docker container started\n';
      }
      if (logs.includes('Starting Xvfb')) {
        statusMessage += '🖥️ Virtual display initialized\n';
      }
      if (logs.includes('Running recording script')) {
        statusMessage += '📝 Recording script running\n';
      }
      if (logs.includes('Loading Cesium app')) {
        statusMessage += '🌍 Cesium app loading\n';
      }
      if (logs.includes('Starting route recording')) {
        statusMessage += '📹 Recording animation...\n';
      }
      
      // Check for recording progress
      const recordingMatch = logs.match(/Recorded frame (\d+)\/(\d+)/);
      if (recordingMatch) {
        const current = parseInt(recordingMatch[1]);
        const total = parseInt(recordingMatch[2]);
        const percent = Math.round((current / total) * 100);
        statusMessage += `📹 **Recording:** ${percent}% (${current}/${total} frames)\n`;
      }
      
      if (logs.includes('Starting video encoding')) {
        statusMessage += '🎬 Encoding video...\n';
      }
      if (logs.includes('Video encoding completed')) {
        statusMessage += '✅ Encoding complete!\n';
      }

      // Show last log line for context
      const logLines = logs.trim().split('\n');
      const lastLine = logLines[logLines.length - 1];
      if (lastLine) {
        statusMessage += `\n📋 **Last update:**\n\`${lastLine.substring(0, 200)}\``;
      }
    } catch (error) {
      // If we can't fetch logs, just show basic status
      console.error('Error fetching logs for status:', error.message);
      statusMessage += '⏳ Logs not available yet...';
    }
  }

  bot.sendMessage(chatId, statusMessage, { parse_mode: 'Markdown' });
});

// Logs command
bot.onText(/\/logs/, async (msg) => {
  const chatId = msg.chat.id;
  const userLang = msg.from.language_code || 'en';
  const render = activeRenders.get(chatId);

  if (!render || !render.outputId) {
    bot.sendMessage(chatId, t(chatId, 'errors.noLogs', {}, userLang));
    return;
  }

  try {
    await bot.sendMessage(chatId, t(chatId, 'logs.fetching', {}, userLang));

    const logsUrl = `${API_SERVER}/logs/${render.outputId}/text`;
    const response = await axios.get(logsUrl);

    const logs = response.data;

    // Telegram has a 4096 character limit per message
    if (logs.length <= 4096) {
      await bot.sendMessage(chatId, `\`\`\`\n${logs}\n\`\`\``, { parse_mode: 'Markdown' });
    } else {
      // Split into chunks or send as file
      const tempLogFile = path.join(__dirname, 'temp', `logs-${render.outputId}.txt`);
      fs.mkdirSync(path.dirname(tempLogFile), { recursive: true });
      fs.writeFileSync(tempLogFile, logs);

      await bot.sendDocument(chatId, tempLogFile, {}, {
        filename: `logs-${render.outputId}.txt`,
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

// Handle document (GPX file)
bot.on('document', async (msg) => {
  const chatId = msg.chat.id;
  const doc = msg.document;
  const userLang = msg.from.language_code || 'en';

  // Check if it's a GPX file
  if (!doc.file_name.toLowerCase().endsWith('.gpx')) {
    bot.sendMessage(chatId, t(chatId, 'errors.notGpx', {}, userLang));
    return;
  }

  try {
    // Send initial message
    await bot.sendMessage(chatId, t(chatId, 'processing.downloading', {}, userLang));

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

    // Analyze GPX and show analytics
    await bot.sendMessage(chatId, t(chatId, 'processing.analyzing', {}, userLang));

    const gpxContent = gpxBuffer.toString('utf8');
    const analysis = analyzeGPX(gpxContent);

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
    if (analysis.success && analysis.statistics.duration) {
      const routeDurationMinutes = analysis.statistics.duration.minutes;

      // Calculate adaptive animation speed (same logic as server)
      const MAX_VIDEO_MINUTES = 5;
      let animationSpeed = 100;
      const requiredSpeed = Math.ceil(routeDurationMinutes / (MAX_VIDEO_MINUTES - 0.5));

      if (requiredSpeed > 100) {
        animationSpeed = requiredSpeed;
      }

      // Estimate render time
      // Recording duration in seconds
      const recordingSeconds = (routeDurationMinutes * 60 / animationSpeed) + 19;
      const recordingMinutes = recordingSeconds / 60;

      // Encoding is ~7x slower than real-time for current settings
      const ENCODING_RATIO = 7;
      const encodingMinutes = recordingMinutes * ENCODING_RATIO;

      // Total with overhead
      const overheadMinutes = 1.5; // ~90 seconds
      const estimatedRenderMinutes = Math.ceil(recordingMinutes + encodingMinutes + overheadMinutes);

      // Estimate file size
      const bitrateKbps = 2500;
      const estimatedSizeMB = Math.ceil((recordingSeconds * bitrateKbps) / 8 / 1024);

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

    // Track this render
    activeRenders.set(chatId, {
      status: 'rendering',
      outputId: outputId,
      fileName: doc.file_name
    });

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
            } else if (logs.includes('Recording progress:')) {
              // Extract recording progress
              const progressMatch = logs.match(/Recording progress: (\d+)\/(\d+)s \((\d+)%\)/);
              if (progressMatch) {
                const [, current, total, percent] = progressMatch;
                newStage = 'recording';
                statusMessage = t(chatId, 'processing.recording', { percent, current, total }, userLang);
              }
            } else if (logs.includes('Waiting for map tiles to fully load')) {
              newStage = 'loading';
              statusMessage = t(chatId, 'processing.loading', {}, userLang);
            } else if (logs.includes('Cesium app loaded')) {
              newStage = 'initializing';
              statusMessage = t(chatId, 'processing.initializing', {}, userLang);
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

    // Store outputId if available (for logs access even on failure)
    activeRenders.set(chatId, {
      status: result && result.success ? 'completed' : 'failed',
      outputId: finalOutputId,
      fileName: doc.file_name,
      videoPath: result ? result.videoUrl : null
    });

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

    // Update status
    activeRenders.set(chatId, {
      status: 'completed',
      outputId: result.outputId,
      fileName: doc.file_name,
      videoPath: result.videoUrl
    });

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

    // Cleanup
    fs.unlinkSync(tempPath);
    activeRenders.delete(chatId);

  } catch (error) {
    console.error('Error processing GPX:', error);

    // Get the render info if available
    const render = activeRenders.get(chatId);

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

    activeRenders.delete(chatId);
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
