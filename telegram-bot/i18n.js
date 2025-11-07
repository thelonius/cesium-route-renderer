// Internationalization module for Telegram bot
// Supports English and Russian with auto-detection

const messages = {
  en: {
    // Welcome & Help
    welcome: {
      title: '🗺️ Welcome to GPX Route Video Renderer!',
      description: 'Send me a GPX file and I\'ll create a beautiful 3D video animation of your route.',
      features: [
        '📱 Video format: Vertical (1080x1920) perfect for mobile',
        '🎥 Features: Intro/outro animations, smooth camera tracking',
        '⏱️ Processing time: ~2-3 minutes per route'
      ],
      cta: 'Just send me your GPX file to get started!'
    },
    help: {
      title: '📖 How to use:',
      steps: [
        '1️⃣ Send me a GPX file (as document)',
        '2️⃣ Wait for processing (you\'ll get progress updates)',
        '3️⃣ Receive your video!'
      ],
      tips: '💡 Tips:',
      tipsList: [
        '• Routes without timestamps will use 5 km/h walking speed',
        '• Animation plays at 100x speed',
        '• Video includes 5s intro and 4s outro'
      ],
      commands: 'Commands:',
      commandsList: [
        '/start - Start the bot',
        '/help - Show this help',
        '/status - Check current render status',
        '/logs - View detailed logs for your last render',
        '/language - Change language (English/Русский)',
        '/cleanup - Delete renders older than 7 days (admin)'
      ]
    },

    // Language
    language: {
      current: '🌐 Current language: English',
      select: 'Select your language:',
      changed: '✅ Language changed to English'
    },

    // Status & Errors
    status: {
      noActive: '❌ No active renders. Send me a GPX file to start!',
      current: '⏳ Current status: {{status}}\n📊 Output ID: {{outputId}}'
    },
    errors: {
      notGpx: '❌ Please send a GPX file (.gpx extension)',
      noLogs: '❌ No render to show logs for. Complete a render first!',
      logsFailed: '❌ Failed to fetch logs.',
      logsNotFound: 'Logs not found for this render.',
      processing: '❌ Error processing your GPX file:\n{{error}}\n\nPlease try again or contact support.',
      processingLong: '❌ Error processing your GPX file. Details too long to display here — sending as a file.',
      unknown: '🤔 I can only process GPX files.\n\nPlease send me a GPX file (as document) to create a route video.\nUse /help for more information.'
    },

    // Processing stages
    processing: {
      downloading: '📥 Downloading your GPX file...',
      analyzing: '🔍 Analyzing route...',
      starting: '🚀 Starting video rendering...\n\n📋 Render ID: `{{outputId}}`\n\n⏱️ This may take several minutes for long routes.\nYou can check logs to monitor progress.',

      // Progress stages
      docker: '🐳 Starting rendering environment...\n\n⏳ Launching containerized browser',
      initializing: '🌍 Initializing 3D globe...\n\n⏳ Setting up camera and route',
      loading: '🗺️ Loading map tiles and terrain...\n\n⏳ Waiting for all imagery to download',
      recording: '📹 Recording animation: {{percent}}%\n\n⏱️ Progress: {{current}}/{{total}} seconds',
      encoding: '🎬 Recording complete! Encoding video...\n\n⏳ This step takes the longest (several minutes)\n📦 Compressing video for optimal quality',
      encodingDone: '✅ Video encoded successfully!\n\n📦 File is ready, wrapping up...',
      finalizing: '✅ Encoding complete! Finalizing...\n\n📦 Preparing video file for upload',

      // Completion
      complete: '✅ Rendering complete!\n📁 File size: {{size}} MB\n📤 Uploading video to Telegram...',
      done: '🎉 Done! Send another GPX file to create more videos.\n\nUse /help for more information.'
    },

    // Estimation
    estimation: {
      title: '🎬 Render Estimation:',
      speed: '⚡ Animation speed: {{speed}}x',
      videoLength: '📹 Video length: ~{{length}} minutes',
      size: '📦 Estimated size: ~{{size}} MB',
      time: '⏱️ Estimated render time: ~{{time}} minutes',
      tooLarge: '⚠️ File will exceed 50MB Telegram limit\n📥 Download link will be provided',
      starting: 'Starting render...',
      default: '🎬 Starting render with default settings...'
    },

    // File size warnings
    fileSize: {
      tooLarge: '⚠️ Video is too large for Telegram!\n\n📊 File size: {{size}} MB\n📏 Telegram limit: {{limit}} MB\n\n📥 Download your video here:\n{{url}}\n\n💡 The video file will be available for download from our server.',
      rejected: '⚠️ Telegram rejected the video (too large)\n\n📊 File size: {{size}} MB\n\n📥 Download your video here:\n{{url}}\n\n💡 The video file is available for download from our server.'
    },

    // Logs
    logs: {
      fetching: '📋 Fetching logs...',
      title: '📋 Logs for `{{outputId}}`:',
      full: '📋 Full logs for render: {{outputId}}',
      available: '📋 Detailed logs available.\nUse /logs to view full rendering logs.',
      notAvailable: '⏳ **Logs not found yet**\n\nThe render may still be starting. Please wait a few seconds and try again.\n\nThe render process:\n1. ⬆️ Uploading GPX file\n2. 🐳 Starting Docker container\n3. 📹 Recording animation\n4. 🎬 Encoding video\n5. ✅ Complete!\n\nLogs will appear after step 2.'
    },

    // Cleanup
    cleanup: {
      starting: '🧹 Cleaning up old renders...',
      complete: '✅ Cleanup complete!\n\n🗑️ Deleted: {{deleted}} old renders\n💾 Space freed: {{space}} MB\n📁 Remaining: {{remaining}} renders',
      failed: '❌ Cleanup failed: {{error}}',
      error: '❌ Failed to cleanup old renders.\n{{error}}'
    },

    // Video caption
    videoCaption: '🎬 Your route video: {{filename}}\n\n📊 Size: {{size}} MB\n🎥 Format: 1080x1920 (Vertical)\n⚡ Animation: 100x speed',

    // Buttons
    buttons: {
      viewLogs: '📋 View Logs',
      viewFullLogs: '📋 View Full Logs',
      refreshLogs: '🔄 Refresh Logs',
      tryAgain: '🔄 Try Again',
      viewServerLogs: '📋 View Server Logs'
    }
  },

  ru: {
    // Welcome & Help
    welcome: {
      title: '🗺️ Добро пожаловать в GPX Route Video Renderer!',
      description: 'Отправьте мне GPX файл, и я создам красивое 3D видео анимации вашего маршрута.',
      features: [
        '📱 Формат видео: Вертикальный (1080x1920) идеально для мобильных',
        '🎥 Возможности: Интро/аутро анимации, плавное отслеживание камеры',
        '⏱️ Время обработки: ~2-3 минуты на маршрут'
      ],
      cta: 'Просто отправьте мне ваш GPX файл, чтобы начать!'
    },
    help: {
      title: '📖 Как использовать:',
      steps: [
        '1️⃣ Отправьте мне GPX файл (как документ)',
        '2️⃣ Дождитесь обработки (вы получите обновления прогресса)',
        '3️⃣ Получите ваше видео!'
      ],
      tips: '💡 Советы:',
      tipsList: [
        '• Маршруты без временных меток будут использовать скорость 5 км/ч',
        '• Анимация воспроизводится со скоростью 100x',
        '• Видео включает 5с интро и 4с аутро'
      ],
      commands: 'Команды:',
      commandsList: [
        '/start - Запустить бота',
        '/help - Показать эту справку',
        '/status - Проверить статус текущего рендера',
        '/logs - Просмотреть подробные логи последнего рендера',
        '/language - Сменить язык (English/Русский)',
        '/cleanup - Удалить рендеры старше 7 дней (админ)'
      ]
    },

    // Language
    language: {
      current: '🌐 Текущий язык: Русский',
      select: 'Выберите ваш язык:',
      changed: '✅ Язык изменён на Русский'
    },

    // Status & Errors
    status: {
      noActive: '❌ Нет активных рендеров. Отправьте мне GPX файл, чтобы начать!',
      current: '⏳ Текущий статус: {{status}}\n📊 ID рендера: {{outputId}}'
    },
    errors: {
      notGpx: '❌ Пожалуйста, отправьте GPX файл (с расширением .gpx)',
      noLogs: '❌ Нет рендера для показа логов. Сначала завершите рендер!',
      logsFailed: '❌ Не удалось получить логи.',
      logsNotFound: 'Логи для этого рендера не найдены.',
      processing: '❌ Ошибка обработки вашего GPX файла:\n{{error}}\n\nПожалуйста, попробуйте снова или свяжитесь с поддержкой.',
      processingLong: '❌ Ошибка обработки вашего GPX файла. Детали слишком длинные для отображения — отправляю как файл.',
      unknown: '🤔 Я могу обрабатывать только GPX файлы.\n\nПожалуйста, отправьте мне GPX файл (как документ) для создания видео маршрута.\nИспользуйте /help для дополнительной информации.'
    },

    // Processing stages
    processing: {
      downloading: '📥 Загружаю ваш GPX файл...',
      analyzing: '🔍 Анализирую маршрут...',
      starting: '🚀 Запускаю рендеринг видео...\n\n📋 ID рендера: `{{outputId}}`\n\n⏱️ Это может занять несколько минут для длинных маршрутов.\nВы можете проверить логи для отслеживания прогресса.',

      // Progress stages
      docker: '🐳 Запускаю среду рендеринга...\n\n⏳ Запуск контейнеризованного браузера',
      initializing: '🌍 Инициализирую 3D глобус...\n\n⏳ Настройка камеры и маршрута',
      loading: '🗺️ Загружаю тайлы карты и рельеф...\n\n⏳ Ожидание загрузки всех изображений',
      recording: '📹 Запись анимации: {{percent}}%\n\n⏱️ Прогресс: {{current}}/{{total}} секунд',
      encoding: '🎬 Запись завершена! Кодирую видео...\n\n⏳ Этот шаг занимает больше всего времени (несколько минут)\n📦 Сжатие видео для оптимального качества',
      encodingDone: '✅ Видео успешно закодировано!\n\n📦 Файл готов, завершаю...',
      finalizing: '✅ Кодирование завершено! Финализирую...\n\n📦 Подготовка видео файла для загрузки',

      // Completion
      complete: '✅ Рендеринг завершён!\n📁 Размер файла: {{size}} МБ\n📤 Загружаю видео в Telegram...',
      done: '🎉 Готово! Отправьте другой GPX файл для создания новых видео.\n\nИспользуйте /help для дополнительной информации.'
    },

    // Estimation
    estimation: {
      title: '🎬 Оценка рендера:',
      speed: '⚡ Скорость анимации: {{speed}}x',
      videoLength: '📹 Длина видео: ~{{length}} минут',
      size: '📦 Ожидаемый размер: ~{{size}} МБ',
      time: '⏱️ Ожидаемое время рендера: ~{{time}} минут',
      tooLarge: '⚠️ Файл превысит лимит Telegram в 50МБ\n📥 Будет предоставлена ссылка для загрузки',
      starting: 'Запускаю рендер...',
      default: '🎬 Запускаю рендер с настройками по умолчанию...'
    },

    // File size warnings
    fileSize: {
      tooLarge: '⚠️ Видео слишком большое для Telegram!\n\n📊 Размер файла: {{size}} МБ\n📏 Лимит Telegram: {{limit}} МБ\n\n📥 Скачайте ваше видео здесь:\n{{url}}\n\n💡 Видео файл доступен для загрузки с нашего сервера.',
      rejected: '⚠️ Telegram отклонил видео (слишком большое)\n\n📊 Размер файла: {{size}} МБ\n\n📥 Скачайте ваше видео здесь:\n{{url}}\n\n💡 Видео файл доступен для загрузки с нашего сервера.'
    },

    // Logs
    logs: {
      fetching: '📋 Получаю логи...',
      title: '📋 Логи для `{{outputId}}`:',
      full: '📋 Полные логи для рендера: {{outputId}}',
      available: '📋 Доступны подробные логи.\nИспользуйте /logs для просмотра полных логов рендеринга.',
      notAvailable: '⏳ **Логи ещё не найдены**\n\nРендер может всё ещё запускаться. Пожалуйста, подождите несколько секунд и попробуйте снова.\n\nПроцесс рендеринга:\n1. ⬆️ Загрузка GPX файла\n2. 🐳 Запуск Docker контейнера\n3. 📹 Запись анимации\n4. 🎬 Кодирование видео\n5. ✅ Завершено!\n\nЛоги появятся после шага 2.'
    },

    // Cleanup
    cleanup: {
      starting: '🧹 Очищаю старые рендеры...',
      complete: '✅ Очистка завершена!\n\n🗑️ Удалено: {{deleted}} старых рендеров\n💾 Освобождено места: {{space}} МБ\n📁 Осталось: {{remaining}} рендеров',
      failed: '❌ Очистка не удалась: {{error}}',
      error: '❌ Не удалось очистить старые рендеры.\n{{error}}'
    },

    // Video caption
    videoCaption: '🎬 Ваше видео маршрута: {{filename}}\n\n📊 Размер: {{size}} МБ\n🎥 Формат: 1080x1920 (Вертикальный)\n⚡ Анимация: 100x скорость',

    // Buttons
    buttons: {
      viewLogs: '📋 Просмотреть логи',
      viewFullLogs: '📋 Просмотреть полные логи',
      refreshLogs: '🔄 Обновить логи',
      tryAgain: '🔄 Попробовать снова',
      viewServerLogs: '📋 Просмотреть логи сервера'
    }
  }
};

// Store user language preferences
const userLanguages = new Map();

/**
 * Get user's preferred language
 * @param {number} chatId - Telegram chat ID
 * @param {string} defaultLang - Default language from Telegram (e.g., 'ru', 'en')
 * @returns {string} Language code ('en' or 'ru')
 */
function getUserLanguage(chatId, defaultLang = 'en') {
  // Check if user has manually set a preference
  if (userLanguages.has(chatId)) {
    return userLanguages.get(chatId);
  }

  // Auto-detect from Telegram language
  if (defaultLang && defaultLang.startsWith('ru')) {
    return 'ru';
  }

  return 'en';
}

/**
 * Set user's language preference
 * @param {number} chatId - Telegram chat ID
 * @param {string} lang - Language code ('en' or 'ru')
 */
function setUserLanguage(chatId, lang) {
  if (lang === 'en' || lang === 'ru') {
    userLanguages.set(chatId, lang);
    return true;
  }
  return false;
}

/**
 * Get a message in the user's language
 * @param {number} chatId - Telegram chat ID
 * @param {string} key - Message key (e.g., 'welcome.title')
 * @param {object} params - Parameters for template substitution
 * @param {string} defaultLang - Default language from Telegram
 * @returns {string} Localized message
 */
function t(chatId, key, params = {}, defaultLang = 'en') {
  const lang = getUserLanguage(chatId, defaultLang);
  const keys = key.split('.');

  let message = messages[lang];
  for (const k of keys) {
    if (message && typeof message === 'object') {
      message = message[k];
    } else {
      break;
    }
  }

  // Fallback to English if key not found
  if (!message) {
    message = messages.en;
    for (const k of keys) {
      if (message && typeof message === 'object') {
        message = message[k];
      } else {
        break;
      }
    }
  }

  // If message is an array (for lists), join with newlines
  if (Array.isArray(message)) {
    message = message.join('\n');
  }

  // If still not found, return the key
  if (!message) {
    return key;
  }

  // Replace template variables
  let result = message;
  for (const [param, value] of Object.entries(params)) {
    result = result.replace(new RegExp(`{{${param}}}`, 'g'), value);
  }

  return result;
}

/**
 * Format a complete message with title and content
 * @param {number} chatId - Telegram chat ID
 * @param {string} baseKey - Base key for the message section
 * @param {object} params - Parameters for template substitution
 * @param {string} defaultLang - Default language from Telegram
 * @returns {string} Formatted message
 */
function formatMessage(chatId, baseKey, params = {}, defaultLang = 'en') {
  const lang = getUserLanguage(chatId, defaultLang);
  const section = messages[lang][baseKey] || messages.en[baseKey];

  if (!section) return '';

  let result = [];

  if (section.title) result.push(section.title);
  if (section.description) result.push(section.description);
  if (section.features) result.push('\n' + section.features.join('\n'));
  if (section.steps) result.push('\n' + section.steps.join('\n'));
  if (section.tips) {
    result.push('\n' + section.tips);
    if (section.tipsList) result.push(section.tipsList.join('\n'));
  }
  if (section.commands) {
    result.push('\n' + section.commands);
    if (section.commandsList) result.push(section.commandsList.join('\n'));
  }
  if (section.cta) result.push('\n' + section.cta);

  return result.join('\n');
}

module.exports = {
  getUserLanguage,
  setUserLanguage,
  t,
  formatMessage,
  messages
};
