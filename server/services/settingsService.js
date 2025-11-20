/**
 * Settings Service - Singleton for managing application settings
 * Handles loading, caching, and persisting settings from settings.json
 */

const fs = require('fs');
const path = require('path');
const CONSTANTS = require('../../config/constants');

class SettingsService {
  constructor() {
    this.settings = null;
    this.settingsPath = path.join(__dirname, '../settings.json');
    this.defaultSettings = this.getDefaultSettings();
  }

  /**
   * Get default settings structure
   * @returns {Object} Default settings
   */
  getDefaultSettings() {
    return {
      animation: {
        defaultSpeed: CONSTANTS.ANIMATION.DEFAULT_SPEED,
        minSpeed: CONSTANTS.ANIMATION.MIN_SPEED,
        maxSpeed: CONSTANTS.ANIMATION.MAX_SPEED,
        adaptiveSpeedEnabled: true,
        maxVideoMinutes: CONSTANTS.RENDER.MAX_VIDEO_MINUTES
      },
      recording: {
        fps: CONSTANTS.RENDER.DEFAULT_FPS,
        width: CONSTANTS.RENDER.DEFAULT_WIDTH,
        height: CONSTANTS.RENDER.DEFAULT_HEIGHT
      },
      camera: {
        // Placeholder for future camera settings
        enabled: false,
        defaultHeight: 150,
        defaultTilt: 45,
        smoothingFactor: 0.7
      }
    };
  }

  /**
   * Load settings from file or use defaults
   * @param {boolean} forceReload - Force reload from disk
   * @returns {Object} Settings object
   */
  load(forceReload = false) {
    // Return cached settings unless force reload
    if (this.settings && !forceReload) {
      return this.settings;
    }

    try {
      if (fs.existsSync(this.settingsPath)) {
        const fileContent = fs.readFileSync(this.settingsPath, 'utf8');
        this.settings = JSON.parse(fileContent);

        // Merge with defaults to ensure all keys exist
        this.settings = this.mergeWithDefaults(this.settings);

        console.log('✅ Settings loaded from file');
      } else {
        console.log('⚠️  Settings file not found, using defaults');
        this.settings = this.defaultSettings;

        // Create settings file with defaults
        this.save();
      }
    } catch (error) {
      console.error('❌ Error loading settings, using defaults:', error.message);
      this.settings = this.defaultSettings;
    }

    return this.settings;
  }

  /**
   * Merge loaded settings with defaults to ensure all keys exist
   * @param {Object} loadedSettings - Settings loaded from file
   * @returns {Object} Merged settings
   */
  mergeWithDefaults(loadedSettings) {
    const merged = JSON.parse(JSON.stringify(this.defaultSettings)); // Deep clone

    // Recursively merge
    const deepMerge = (target, source) => {
      for (const key in source) {
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
          target[key] = target[key] || {};
          deepMerge(target[key], source[key]);
        } else {
          target[key] = source[key];
        }
      }
      return target;
    };

    return deepMerge(merged, loadedSettings);
  }

  /**
   * Save settings to file
   * @returns {boolean} Success status
   */
  save() {
    try {
      fs.writeFileSync(this.settingsPath, JSON.stringify(this.settings, null, 2));
      console.log('✅ Settings saved to file');
      return true;
    } catch (error) {
      console.error('❌ Error saving settings:', error.message);
      return false;
    }
  }

  /**
   * Get nested setting value using dot notation
   * @param {string} path - Dot notation path (e.g., 'animation.defaultSpeed')
   * @returns {*} Setting value or undefined
   */
  get(path) {
    if (!this.settings) {
      this.load();
    }

    const keys = path.split('.');
    let value = this.settings;

    for (const key of keys) {
      if (value && typeof value === 'object' && key in value) {
        value = value[key];
      } else {
        return undefined;
      }
    }

    return value;
  }

  /**
   * Update nested setting value using dot notation
   * @param {string} path - Dot notation path
   * @param {*} value - New value
   * @returns {boolean} Success status
   */
  update(path, value) {
    if (!this.settings) {
      this.load();
    }

    const keys = path.split('.');
    const lastKey = keys.pop();
    let target = this.settings;

    // Navigate to parent object
    for (const key of keys) {
      if (!target[key] || typeof target[key] !== 'object') {
        target[key] = {};
      }
      target = target[key];
    }

    // Update value
    target[lastKey] = value;

    return this.save();
  }

  /**
   * Update entire settings object
   * @param {Object} newSettings - New settings object
   * @returns {boolean} Success status
   */
  updateAll(newSettings) {
    this.settings = this.mergeWithDefaults(newSettings);
    return this.save();
  }

  /**
   * Get animation settings
   * @returns {Object} Animation settings
   */
  getAnimationSettings() {
    if (!this.settings) {
      this.load();
    }
    return this.settings.animation;
  }

  /**
   * Get recording settings
   * @returns {Object} Recording settings
   */
  getRecordingSettings() {
    if (!this.settings) {
      this.load();
    }
    return this.settings.recording;
  }

  /**
   * Get camera settings (for future use)
   * @returns {Object} Camera settings
   */
  getCameraSettings() {
    if (!this.settings) {
      this.load();
    }
    return this.settings.camera || this.defaultSettings.camera;
  }

  /**
   * Validate animation speed is within bounds
   * @param {number} speed - Speed to validate
   * @returns {Object} Validation result
   */
  validateAnimationSpeed(speed) {
    const { minSpeed, maxSpeed } = this.getAnimationSettings();

    if (speed < minSpeed || speed > maxSpeed) {
      return {
        valid: false,
        error: `Speed must be between ${minSpeed} and ${maxSpeed}`
      };
    }

    return { valid: true };
  }

  /**
   * Get all settings
   * @returns {Object} Complete settings object
   */
  getAll() {
    if (!this.settings) {
      this.load();
    }
    return this.settings;
  }

  /**
   * Reset to default settings
   * @returns {boolean} Success status
   */
  reset() {
    this.settings = this.defaultSettings;
    return this.save();
  }
}

// Export singleton instance
module.exports = new SettingsService();
