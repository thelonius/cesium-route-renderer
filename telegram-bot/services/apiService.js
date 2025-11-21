const axios = require('axios');

/**
 * API Service for Telegram Bot
 *
 * Handles all communication with the API server:
 * - Render requests
 * - Status checks
 * - Log retrieval
 * - Cleanup operations
 * - System statistics
 *
 * Centralizes error handling and retry logic for API calls.
 */
class ApiService {
  constructor(apiServerUrl, publicUrl) {
    this.apiServer = apiServerUrl || 'http://localhost:3000';
    this.publicUrl = publicUrl || apiServerUrl || 'http://localhost:3000';
    this.timeout = 120000; // 2 minutes default timeout
  }

  /**
   * Submit a GPX/KML file for rendering
   *
   * @param {Buffer} fileBuffer - File data
   * @param {string} fileName - Original file name
   * @param {string} userName - User's display name
   * @param {string} outputId - Optional output ID
   * @returns {Promise<Object>} Render result
   */
  async submitRender(fileBuffer, fileName, userName, outputId = null) {
    const FormData = require('form-data');
    const form = new FormData();

    form.append('gpx', fileBuffer, {
      filename: fileName,
      contentType: fileName.endsWith('.kml') ? 'application/vnd.google-earth.kml+xml' : 'application/gpx+xml'
    });
    form.append('userName', userName);

    if (outputId) {
      form.append('outputId', outputId);
    }

    try {
      const response = await axios.post(`${this.apiServer}/render-route`, form, {
        headers: form.getHeaders(),
        timeout: this.timeout,
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      });

      return {
        success: true,
        data: response.data
      };
    } catch (error) {
      console.error('API render request failed:', error.message);
      return {
        success: false,
        error: error.message,
        details: error.response?.data || null,
        status: error.response?.status || null
      };
    }
  }

  /**
   * Check render status
   *
   * @param {string} outputId - Render output ID
   * @returns {Promise<Object>} Status result
   */
  async checkStatus(outputId) {
    try {
      const response = await axios.get(`${this.apiServer}/status/${outputId}`, {
        timeout: 10000
      });

      return {
        success: true,
        data: response.data
      };
    } catch (error) {
      console.error(`Status check failed for ${outputId}:`, error.message);
      return {
        success: false,
        error: error.message,
        status: error.response?.status || null
      };
    }
  }

  /**
   * Get render logs (JSON format)
   *
   * @param {string} outputId - Render output ID
   * @returns {Promise<Object>} Logs result
   */
  async getLogs(outputId) {
    try {
      const response = await axios.get(`${this.apiServer}/logs/${outputId}`, {
        timeout: 15000
      });

      return {
        success: true,
        data: response.data
      };
    } catch (error) {
      console.error(`Logs retrieval failed for ${outputId}:`, error.message);
      return {
        success: false,
        error: error.message,
        status: error.response?.status || null
      };
    }
  }

  /**
   * Get render logs (text format)
   *
   * @param {string} outputId - Render output ID
   * @returns {Promise<Object>} Logs result
   */
  async getLogsText(outputId) {
    try {
      const response = await axios.get(`${this.apiServer}/logs/${outputId}/text`, {
        timeout: 15000
      });

      return {
        success: true,
        text: response.data
      };
    } catch (error) {
      console.error(`Text logs retrieval failed for ${outputId}:`, error.message);
      return {
        success: false,
        error: error.message,
        status: error.response?.status || null
      };
    }
  }

  /**
   * Run cleanup operation
   *
   * @param {number} daysOld - Age threshold in days
   * @returns {Promise<Object>} Cleanup result
   */
  async runCleanup(daysOld = 7) {
    try {
      const response = await axios.get(`${this.apiServer}/cleanup`, {
        params: { daysOld },
        timeout: 60000 // 1 minute for cleanup
      });

      return {
        success: true,
        data: response.data
      };
    } catch (error) {
      console.error('Cleanup failed:', error.message);
      return {
        success: false,
        error: error.message,
        status: error.response?.status || null
      };
    }
  }

  /**
   * Get system statistics
   *
   * @returns {Promise<Object>} Stats result
   */
  async getStats() {
    try {
      const response = await axios.get(`${this.apiServer}/api/stats`, {
        timeout: 10000
      });

      return {
        success: true,
        data: response.data
      };
    } catch (error) {
      console.error('Stats retrieval failed:', error.message);
      return {
        success: false,
        error: error.message,
        status: error.response?.status || null
      };
    }
  }

  /**
   * Get active renders
   *
   * @returns {Promise<Object>} Active renders result
   */
  async getActiveRenders() {
    try {
      const response = await axios.get(`${this.apiServer}/api/active-renders`, {
        timeout: 10000
      });

      return {
        success: true,
        data: response.data
      };
    } catch (error) {
      console.error('Active renders retrieval failed:', error.message);
      return {
        success: false,
        error: error.message,
        status: error.response?.status || null
      };
    }
  }

  /**
   * Cancel a render
   *
   * @param {string} outputId - Render output ID
   * @returns {Promise<Object>} Cancel result
   */
  async cancelRender(outputId) {
    try {
      const response = await axios.delete(`${this.apiServer}/render/${outputId}`, {
        timeout: 10000
      });

      return {
        success: true,
        data: response.data
      };
    } catch (error) {
      console.error(`Cancel failed for ${outputId}:`, error.message);
      return {
        success: false,
        error: error.message,
        status: error.response?.status || null
      };
    }
  }

  /**
   * Get settings
   *
   * @returns {Promise<Object>} Settings result
   */
  async getSettings() {
    try {
      const response = await axios.get(`${this.apiServer}/api/settings`, {
        timeout: 5000
      });

      return {
        success: true,
        data: response.data
      };
    } catch (error) {
      console.error('Settings retrieval failed:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Update settings
   *
   * @param {Object} settings - New settings
   * @returns {Promise<Object>} Update result
   */
  async updateSettings(settings) {
    try {
      const response = await axios.put(`${this.apiServer}/api/settings`, settings, {
        timeout: 5000
      });

      return {
        success: true,
        data: response.data
      };
    } catch (error) {
      console.error('Settings update failed:', error.message);
      return {
        success: false,
        error: error.message,
        status: error.response?.status || null
      };
    }
  }

  /**
   * Build public video URL
   *
   * @param {string} outputId - Render output ID
   * @returns {string} Public URL
   */
  getVideoUrl(outputId) {
    return `${this.publicUrl}/output/${outputId}/route-video.mp4`;
  }

  /**
   * Build public logs URL
   *
   * @param {string} outputId - Render output ID
   * @returns {string} Public URL
   */
  getLogsUrl(outputId) {
    return `${this.publicUrl}/logs/${outputId}`;
  }

  /**
   * Health check
   *
   * @returns {Promise<boolean>} Server is healthy
   */
  async healthCheck() {
    try {
      const response = await axios.get(`${this.apiServer}/health`, {
        timeout: 5000
      });

      return response.status === 200;
    } catch (error) {
      console.error('Health check failed:', error.message);
      return false;
    }
  }

  /**
   * Get API server URL
   *
   * @returns {string} API server URL
   */
  getApiServer() {
    return this.apiServer;
  }

  /**
   * Get public URL
   *
   * @returns {string} Public URL
   */
  getPublicUrl() {
    return this.publicUrl;
  }
}

module.exports = ApiService;
