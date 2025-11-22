const { spawn } = require('child_process');
const fs = require('fs');
const CONSTANTS = require('../../config/constants.cjs');
const dockerConfig = require('../../config/docker');
const memoryMonitorService = require('./memoryMonitorService');

/**
 * Docker Service
 *
 * Encapsulates all Docker container operations for route rendering:
 * - Container lifecycle management (start, stop, monitor)
 * - Output streaming and logging
 * - Memory usage monitoring
 * - Error handling and cleanup
 * - Container configuration and environment setup
 */
class DockerService {
  constructor() {
    this.activeContainers = new Map(); // Track running containers
  }

  /**
   * Run Docker container for route rendering
   *
   * @param {Object} config - Container configuration
   * @param {Object} callbacks - Event callbacks
   * @returns {Object} Container control object
   */
  runContainer(config, callbacks = {}) {
    const {
      gpxPath,
      gpxFilename,
      outputDir,
      animationSpeed,
      userName,
      recording,
      logPath
    } = config;

    const {
      onStdout = () => {},
      onStderr = () => {},
      onError = () => {},
      onClose = () => {},
      onMemoryWarning = () => {}
    } = callbacks;

    // Build Docker arguments
    const dockerArgs = dockerConfig.buildCompleteArgs({
      gpxPath,
      gpxFilename,
      outputDir,
      animationSpeed,
      userName,
      recording
    });

    console.log('Running Docker command:', 'docker', dockerArgs.join(' '));

    // Spawn Docker process
    const dockerProcess = spawn('docker', dockerArgs);
    const containerId = `render_${Date.now()}`;

    // Output buffers
    let stdoutBuffer = '';
    let stderrBuffer = '';

    // Start memory monitoring with dedicated service
    const startTime = Date.now();
    const memoryMonitor = memoryMonitorService.createMonitor(containerId, {
      intervalMs: CONSTANTS.MEMORY.CHECK_INTERVAL_MS,
      warningThresholdMB: CONSTANTS.MEMORY.WARNING_THRESHOLD_MB,
      criticalThresholdMB: CONSTANTS.MEMORY.CRITICAL_THRESHOLD_MB,
      logPath: logPath,
      onWarning: (measurement) => {
        onMemoryWarning(measurement);
      },
      onCritical: (measurement) => {
        console.error(`🚨 CRITICAL memory during Docker operation ${containerId}`);
        // Could trigger container stop here if needed
      }
    });

    // Stream stdout
    dockerProcess.stdout.on('data', (data) => {
      const text = data.toString();
      stdoutBuffer += text;

      if (logPath) {
        fs.appendFileSync(logPath, text);
      }

      console.log('Docker stdout:', text.trim());
      onStdout(text, stdoutBuffer);
    });

    // Stream stderr
    dockerProcess.stderr.on('data', (data) => {
      const text = data.toString();
      stderrBuffer += text;

      if (logPath) {
        fs.appendFileSync(logPath, text);
      }

      console.error('Docker stderr:', text.trim());
      onStderr(text, stderrBuffer);
    });

    // Handle errors
    dockerProcess.on('error', (error) => {
      console.error('Docker spawn error:', error);
      const memoryStats = memoryMonitor.stop();

      this.activeContainers.delete(containerId);

      onError(error, {
        stdout: stdoutBuffer,
        stderr: stderrBuffer,
        memoryStats
      });
    });

    // Handle completion
    dockerProcess.on('close', (code) => {
      const memoryStats = memoryMonitor.stop();

      this.activeContainers.delete(containerId);

      onClose(code, {
        stdout: stdoutBuffer,
        stderr: stderrBuffer,
        memoryStats,
        duration: Date.now() - startTime
      });
    });

    // Store container info
    const containerInfo = {
      id: containerId,
      process: dockerProcess,
      startTime,
      config,
      memoryMonitor,
      getOutput: () => ({ stdout: stdoutBuffer, stderr: stderrBuffer }),
      getMemoryStats: () => memoryMonitor.getStats()
    };

    this.activeContainers.set(containerId, containerInfo);

    return containerInfo;
  }

  /**
   * Stop a running container
   *
   * @param {string} containerId - Container ID
   * @returns {boolean} Success
   */
  stopContainer(containerId) {
    const container = this.activeContainers.get(containerId);

    if (!container) {
      return false;
    }

    try {
      container.memoryMonitor.stop();
      container.process.kill('SIGTERM');
      this.activeContainers.delete(containerId);
      return true;
    } catch (error) {
      console.error(`Failed to stop container ${containerId}:`, error);
      return false;
    }
  }

  /**
   * Stop all running containers
   */
  stopAllContainers() {
    const containers = Array.from(this.activeContainers.keys());

    containers.forEach(containerId => {
      this.stopContainer(containerId);
    });

    return containers.length;
  }

  /**
   * Get container information
   *
   * @param {string} containerId - Container ID
   * @returns {Object|null} Container info
   */
  getContainer(containerId) {
    return this.activeContainers.get(containerId) || null;
  }

  /**
   * Get all active containers
   *
   * @returns {Array} Array of container info
   */
  getActiveContainers() {
    return Array.from(this.activeContainers.values()).map(container => ({
      id: container.id,
      startTime: container.startTime,
      uptime: Date.now() - container.startTime,
      config: container.config
    }));
  }

  /**
   * Build Docker command arguments (for debugging/logging)
   *
   * @param {Object} config - Container configuration
   * @returns {Array} Docker arguments
   */
  buildArgs(config) {
    return dockerConfig.buildCompleteArgs(config);
  }

  /**
   * Validate Docker environment
   * Checks if Docker is available and properly configured
   *
   * @returns {Promise<Object>} Validation result
   */
  async validateEnvironment() {
    return new Promise((resolve) => {
      const checkProcess = spawn('docker', ['--version']);
      let output = '';

      checkProcess.stdout.on('data', (data) => {
        output += data.toString();
      });

      checkProcess.on('close', (code) => {
        if (code === 0) {
          resolve({
            valid: true,
            dockerVersion: output.trim(),
            gpuAvailable: dockerConfig.hasGPU()
          });
        } else {
          resolve({
            valid: false,
            error: 'Docker not available or not running'
          });
        }
      });

      checkProcess.on('error', (error) => {
        resolve({
          valid: false,
          error: `Docker check failed: ${error.message}`
        });
      });
    });
  }

  /**
   * Get Docker system information
   *
   * @returns {Promise<Object>} Docker system info
   */
  async getDockerInfo() {
    return new Promise((resolve) => {
      const infoProcess = spawn('docker', ['info', '--format', '{{json .}}']);
      let output = '';

      infoProcess.stdout.on('data', (data) => {
        output += data.toString();
      });

      infoProcess.on('close', (code) => {
        if (code === 0) {
          try {
            const info = JSON.parse(output);
            resolve({
              success: true,
              info: {
                containers: info.Containers,
                images: info.Images,
                memoryLimit: info.MemoryLimit,
                cpus: info.NCPU,
                operatingSystem: info.OperatingSystem,
                serverVersion: info.ServerVersion
              }
            });
          } catch (error) {
            resolve({
              success: false,
              error: 'Failed to parse Docker info'
            });
          }
        } else {
          resolve({
            success: false,
            error: 'Docker info command failed'
          });
        }
      });

      infoProcess.on('error', (error) => {
        resolve({
          success: false,
          error: error.message
        });
      });
    });
  }

  /**
   * Trim output for API responses
   *
   * @param {string} output - Output string
   * @param {number} maxLength - Maximum length
   * @returns {string} Trimmed output
   */
  trimOutput(output, maxLength = CONSTANTS.API.LOG_TRIM_LENGTH) {
    if (!output) return '';
    return output.length > maxLength
      ? '...TRUNCATED...\n' + output.slice(-maxLength)
      : output;
  }

  /**
   * Get statistics about Docker service usage
   *
   * @returns {Object} Statistics
   */
  getStats() {
    const containers = this.getActiveContainers();

    return {
      activeContainers: containers.length,
      containers: containers,
      totalUptime: containers.reduce((sum, c) => sum + c.uptime, 0),
      avgUptime: containers.length > 0
        ? containers.reduce((sum, c) => sum + c.uptime, 0) / containers.length
        : 0
    };
  }
}

// Export singleton instance
module.exports = new DockerService();
