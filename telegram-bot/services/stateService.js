const fs = require('fs').promises;
const path = require('path');

/**
 * State Management Service for Telegram Bot
 *
 * Handles:
 * - Active renders tracking (per-user)
 * - Route history with file persistence
 * - Cleanup of stale state
 *
 * State is persisted to telegram-bot/data/routeHistory.json
 */
class StateService {
  constructor(historyLimit = 10, historyPath = null) {
    this.activeRenders = new Map(); // chatId -> renderInfo
    this.routeHistory = new Map(); // chatId -> [route1, route2, ...]
    this.historyLimit = historyLimit;
    this.historyPath = historyPath || path.join(__dirname, '../data/routeHistory.json');
    this.loaded = false;
  }

  /**
   * Initialize service - load history from disk
   *
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this.loaded) {
      return;
    }

    await this.loadHistory();
    this.loaded = true;
    console.log(`State service initialized. History: ${this.routeHistory.size} users`);
  }

  /**
   * Load route history from file
   *
   * @returns {Promise<void>}
   */
  async loadHistory() {
    try {
      // Ensure data directory exists
      const dataDir = path.dirname(this.historyPath);
      await fs.mkdir(dataDir, { recursive: true });

      const data = await fs.readFile(this.historyPath, 'utf8');
      const parsed = JSON.parse(data);

      this.routeHistory.clear();
      for (const [chatId, routes] of Object.entries(parsed)) {
        this.routeHistory.set(parseInt(chatId), routes);
      }

      console.log(`Loaded route history for ${this.routeHistory.size} users`);
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.log('No route history file found. Starting fresh.');
      } else {
        console.error('Failed to load route history:', error.message);
      }
    }
  }

  /**
   * Save route history to file
   *
   * @returns {Promise<void>}
   */
  async saveHistory() {
    try {
      const dataDir = path.dirname(this.historyPath);
      await fs.mkdir(dataDir, { recursive: true });

      const data = {};
      for (const [chatId, routes] of this.routeHistory.entries()) {
        data[chatId] = routes;
      }

      await fs.writeFile(this.historyPath, JSON.stringify(data, null, 2), 'utf8');
      console.log(`Saved route history for ${this.routeHistory.size} users`);
    } catch (error) {
      console.error('Failed to save route history:', error.message);
    }
  }

  /**
   * Get active render for a user
   *
   * @param {number} chatId - Telegram chat ID
   * @returns {Object|null} Active render info or null
   */
  getActiveRender(chatId) {
    return this.activeRenders.get(chatId) || null;
  }

  /**
   * Set active render for a user
   *
   * @param {number} chatId - Telegram chat ID
   * @param {Object} renderInfo - Render information
   * @param {string} renderInfo.outputId - Output ID
   * @param {string} renderInfo.fileName - Original file name
   * @param {number} renderInfo.startTime - Start timestamp
   * @param {string} [renderInfo.status] - Current status
   */
  setActiveRender(chatId, renderInfo) {
    this.activeRenders.set(chatId, {
      outputId: renderInfo.outputId,
      fileName: renderInfo.fileName,
      startTime: renderInfo.startTime || Date.now(),
      status: renderInfo.status || 'processing'
    });
  }

  /**
   * Clear active render for a user
   *
   * @param {number} chatId - Telegram chat ID
   */
  clearActiveRender(chatId) {
    this.activeRenders.delete(chatId);
  }

  /**
   * Check if user has active render
   *
   * @param {number} chatId - Telegram chat ID
   * @returns {boolean} Has active render
   */
  hasActiveRender(chatId) {
    return this.activeRenders.has(chatId);
  }

  /**
   * Get all active renders
   *
   * @returns {Array<Object>} Array of active renders with chat IDs
   */
  getAllActiveRenders() {
    const renders = [];
    for (const [chatId, renderInfo] of this.activeRenders.entries()) {
      renders.push({ chatId, ...renderInfo });
    }
    return renders;
  }

  /**
   * Get route history for a user
   *
   * @param {number} chatId - Telegram chat ID
   * @returns {Array<Object>} Route history (newest first)
   */
  getHistory(chatId) {
    return this.routeHistory.get(chatId) || [];
  }

  /**
   * Add route to user's history
   *
   * @param {number} chatId - Telegram chat ID
   * @param {Object} route - Route information
   * @param {string} route.outputId - Output ID
   * @param {string} route.fileName - Original file name
   * @param {number} route.timestamp - Completion timestamp
   * @param {string} [route.videoUrl] - Video URL
   * @param {Object} [route.analysis] - Route analysis data
   */
  async addToHistory(chatId, route) {
    const history = this.getHistory(chatId);

    // Add to beginning (newest first)
    history.unshift({
      outputId: route.outputId,
      fileName: route.fileName,
      timestamp: route.timestamp || Date.now(),
      videoUrl: route.videoUrl || null,
      analysis: route.analysis || null
    });

    // Trim to limit
    if (history.length > this.historyLimit) {
      history.splice(this.historyLimit);
    }

    this.routeHistory.set(chatId, history);
    await this.saveHistory();
  }

  /**
   * Clear history for a user
   *
   * @param {number} chatId - Telegram chat ID
   */
  async clearHistory(chatId) {
    this.routeHistory.delete(chatId);
    await this.saveHistory();
  }

  /**
   * Get total users with history
   *
   * @returns {number} User count
   */
  getUserCount() {
    return this.routeHistory.size;
  }

  /**
   * Get total routes in history
   *
   * @returns {number} Route count
   */
  getTotalRoutes() {
    let count = 0;
    for (const routes of this.routeHistory.values()) {
      count += routes.length;
    }
    return count;
  }

  /**
   * Cleanup stale active renders
   *
   * Removes renders older than maxAge
   *
   * @param {number} maxAge - Max age in milliseconds (default: 1 hour)
   * @returns {number} Number of renders cleaned up
   */
  cleanupStaleRenders(maxAge = 3600000) {
    const now = Date.now();
    let cleaned = 0;

    for (const [chatId, renderInfo] of this.activeRenders.entries()) {
      if (now - renderInfo.startTime > maxAge) {
        this.activeRenders.delete(chatId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`Cleaned up ${cleaned} stale active renders`);
    }

    return cleaned;
  }

  /**
   * Get statistics
   *
   * @returns {Object} State statistics
   */
  getStats() {
    return {
      activeRenders: this.activeRenders.size,
      totalUsers: this.getUserCount(),
      totalRoutes: this.getTotalRoutes(),
      historyLimit: this.historyLimit,
      loaded: this.loaded
    };
  }

  /**
   * Export all state (for backup)
   *
   * @returns {Object} Complete state
   */
  exportState() {
    return {
      activeRenders: Array.from(this.activeRenders.entries()),
      routeHistory: Array.from(this.routeHistory.entries()),
      historyLimit: this.historyLimit,
      timestamp: Date.now()
    };
  }

  /**
   * Import state (from backup)
   *
   * @param {Object} state - State to import
   */
  async importState(state) {
    if (state.activeRenders) {
      this.activeRenders = new Map(state.activeRenders);
    }

    if (state.routeHistory) {
      this.routeHistory = new Map(state.routeHistory);
      await this.saveHistory();
    }

    console.log('State imported successfully');
  }
}

module.exports = StateService;
