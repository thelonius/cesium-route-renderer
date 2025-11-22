const fs = require('fs');
const CONSTANTS = require('../../config/constants.cjs');

/**
 * Memory Monitor Service
 *
 * Centralized memory monitoring and tracking for server operations:
 * - Real-time memory usage tracking (RSS, heap, external)
 * - Threshold alerts (warning, critical)
 * - Historical tracking with moving averages
 * - Memory leak detection
 * - Resource cleanup recommendations
 * - Process-wide and per-operation monitoring
 */
class MemoryMonitorService {
  constructor() {
    this.monitors = new Map(); // Active monitors by ID
    this.history = []; // Global memory history
    this.maxHistorySize = 1000; // Keep last 1000 measurements
    this.startTime = Date.now();
    this.peakMemory = { rss: 0, heapUsed: 0, external: 0, timestamp: null };
  }

  /**
   * Create a new memory monitor for an operation
   *
   * @param {string} monitorId - Unique identifier for this monitor
   * @param {Object} options - Monitor configuration
   * @returns {Object} Monitor control object
   */
  createMonitor(monitorId, options = {}) {
    const {
      intervalMs = CONSTANTS.MEMORY.CHECK_INTERVAL_MS,
      warningThresholdMB = CONSTANTS.MEMORY.WARNING_THRESHOLD_MB,
      criticalThresholdMB = CONSTANTS.MEMORY.CRITICAL_THRESHOLD_MB,
      logPath = null,
      onWarning = () => {},
      onCritical = () => {},
      onMeasurement = () => {}
    } = options;

    // Check if monitor already exists
    if (this.monitors.has(monitorId)) {
      console.warn(`Memory monitor ${monitorId} already exists, stopping existing monitor`);
      this.stopMonitor(monitorId);
    }

    const monitor = {
      id: monitorId,
      startTime: Date.now(),
      intervalMs,
      warningThresholdMB,
      criticalThresholdMB,
      logPath,
      measurements: [],
      maxMeasurements: 100, // Keep last 100 measurements per monitor
      interval: null,
      callbacks: { onWarning, onCritical, onMeasurement },
      stats: {
        totalMeasurements: 0,
        warningCount: 0,
        criticalCount: 0,
        avgRss: 0,
        avgHeapUsed: 0,
        peakRss: 0,
        peakHeapUsed: 0
      }
    };

    // Start monitoring
    const measureMemory = () => {
      const measurement = this._takeMeasurement(monitor);
      this._updateStats(monitor, measurement);
      this._checkThresholds(monitor, measurement);

      // Store in monitor history (circular buffer)
      monitor.measurements.push(measurement);
      if (monitor.measurements.length > monitor.maxMeasurements) {
        monitor.measurements.shift();
      }

      // Store in global history
      this.history.push({ ...measurement, monitorId });
      if (this.history.length > this.maxHistorySize) {
        this.history.shift();
      }

      // Track global peaks
      if (measurement.rss > this.peakMemory.rss) {
        this.peakMemory = { ...measurement, monitorId };
      }

      // Callback for each measurement
      monitor.callbacks.onMeasurement(measurement);

      return measurement;
    };

    // Take initial measurement
    measureMemory();

    // Schedule periodic measurements
    monitor.interval = setInterval(measureMemory, intervalMs);

    this.monitors.set(monitorId, monitor);

    console.log(`📊 Memory monitor started: ${monitorId} (interval: ${intervalMs}ms)`);

    return {
      id: monitorId,
      getStats: () => this.getMonitorStats(monitorId),
      getCurrentMemory: () => this._getCurrentMemory(),
      stop: () => this.stopMonitor(monitorId)
    };
  }

  /**
   * Stop a memory monitor
   *
   * @param {string} monitorId - Monitor to stop
   * @returns {Object} Final statistics
   */
  stopMonitor(monitorId) {
    const monitor = this.monitors.get(monitorId);
    if (!monitor) {
      console.warn(`Memory monitor ${monitorId} not found`);
      return null;
    }

    // Clear interval
    if (monitor.interval) {
      clearInterval(monitor.interval);
    }

    // Calculate final stats
    const finalStats = this._calculateFinalStats(monitor);

    // Log summary
    if (monitor.logPath) {
      const summary = this._formatSummary(monitor, finalStats);
      fs.appendFileSync(monitor.logPath, summary);
    }

    console.log(`📊 Memory monitor stopped: ${monitorId} | Avg RSS: ${finalStats.avgRss}MB | Peak: ${finalStats.peakRss}MB`);

    // Remove from active monitors
    this.monitors.delete(monitorId);

    return finalStats;
  }

  /**
   * Stop all active monitors
   *
   * @returns {Array} Array of final statistics for all monitors
   */
  stopAllMonitors() {
    const allStats = [];
    for (const monitorId of this.monitors.keys()) {
      const stats = this.stopMonitor(monitorId);
      if (stats) {
        allStats.push({ monitorId, ...stats });
      }
    }
    console.log(`📊 Stopped ${allStats.length} memory monitors`);
    return allStats;
  }

  /**
   * Get statistics for a specific monitor
   *
   * @param {string} monitorId - Monitor ID
   * @returns {Object} Monitor statistics
   */
  getMonitorStats(monitorId) {
    const monitor = this.monitors.get(monitorId);
    if (!monitor) {
      return null;
    }

    return {
      id: monitorId,
      runtime: Date.now() - monitor.startTime,
      ...monitor.stats,
      currentMemory: this._getCurrentMemory(),
      recentMeasurements: monitor.measurements.slice(-10) // Last 10 measurements
    };
  }

  /**
   * Get global memory statistics
   *
   * @returns {Object} Global statistics
   */
  getGlobalStats() {
    const currentMemory = this._getCurrentMemory();
    const uptime = Date.now() - this.startTime;

    return {
      uptime,
      activeMonitors: this.monitors.size,
      currentMemory,
      peakMemory: this.peakMemory,
      totalMeasurements: this.history.length,
      averageMemory: this._calculateGlobalAverage(),
      memoryTrend: this._calculateMemoryTrend(),
      recommendations: this._generateRecommendations()
    };
  }

  /**
   * Take a memory measurement
   * @private
   */
  _takeMeasurement(monitor) {
    const used = process.memoryUsage();
    const elapsed = Date.now() - monitor.startTime;

    const measurement = {
      timestamp: Date.now(),
      elapsed,
      rss: Math.round(used.rss / 1024 / 1024), // MB
      heapUsed: Math.round(used.heapUsed / 1024 / 1024), // MB
      heapTotal: Math.round(used.heapTotal / 1024 / 1024), // MB
      external: Math.round(used.external / 1024 / 1024), // MB
      arrayBuffers: Math.round(used.arrayBuffers / 1024 / 1024) // MB
    };

    // Log to file if specified
    if (monitor.logPath) {
      const logLine = `[${new Date(measurement.timestamp).toISOString()}] 📊 Memory: RSS ${measurement.rss}MB | Heap ${measurement.heapUsed}/${measurement.heapTotal}MB | External ${measurement.external}MB | Elapsed ${Math.round(elapsed / 1000)}s\n`;
      fs.appendFileSync(monitor.logPath, logLine);
    }

    return measurement;
  }

  /**
   * Update monitor statistics
   * @private
   */
  _updateStats(monitor, measurement) {
    monitor.stats.totalMeasurements++;

    // Update averages (moving average)
    const n = monitor.stats.totalMeasurements;
    monitor.stats.avgRss = ((monitor.stats.avgRss * (n - 1)) + measurement.rss) / n;
    monitor.stats.avgHeapUsed = ((monitor.stats.avgHeapUsed * (n - 1)) + measurement.heapUsed) / n;

    // Update peaks
    if (measurement.rss > monitor.stats.peakRss) {
      monitor.stats.peakRss = measurement.rss;
    }
    if (measurement.heapUsed > monitor.stats.peakHeapUsed) {
      monitor.stats.peakHeapUsed = measurement.heapUsed;
    }
  }

  /**
   * Check memory thresholds and trigger callbacks
   * @private
   */
  _checkThresholds(monitor, measurement) {
    // Check critical threshold
    if (measurement.rss >= monitor.criticalThresholdMB) {
      monitor.stats.criticalCount++;

      const criticalLog = `[${new Date().toISOString()}] 🚨 CRITICAL memory usage: ${measurement.rss}MB RSS (threshold: ${monitor.criticalThresholdMB}MB)\n`;

      if (monitor.logPath) {
        fs.appendFileSync(monitor.logPath, criticalLog);
      }

      console.error(criticalLog.trim());
      monitor.callbacks.onCritical(measurement);
    }
    // Check warning threshold
    else if (measurement.rss >= monitor.warningThresholdMB) {
      monitor.stats.warningCount++;

      const warnLog = `[${new Date().toISOString()}] ⚠️  High memory usage: ${measurement.rss}MB RSS (threshold: ${monitor.warningThresholdMB}MB)\n`;

      if (monitor.logPath) {
        fs.appendFileSync(monitor.logPath, warnLog);
      }

      console.warn(warnLog.trim());
      monitor.callbacks.onWarning(measurement);
    }
  }

  /**
   * Get current memory usage
   * @private
   */
  _getCurrentMemory() {
    const used = process.memoryUsage();
    return {
      rss: Math.round(used.rss / 1024 / 1024),
      heapUsed: Math.round(used.heapUsed / 1024 / 1024),
      heapTotal: Math.round(used.heapTotal / 1024 / 1024),
      external: Math.round(used.external / 1024 / 1024),
      arrayBuffers: Math.round(used.arrayBuffers / 1024 / 1024)
    };
  }

  /**
   * Calculate final statistics for a monitor
   * @private
   */
  _calculateFinalStats(monitor) {
    return {
      runtime: Date.now() - monitor.startTime,
      totalMeasurements: monitor.stats.totalMeasurements,
      avgRss: Math.round(monitor.stats.avgRss),
      avgHeapUsed: Math.round(monitor.stats.avgHeapUsed),
      peakRss: monitor.stats.peakRss,
      peakHeapUsed: monitor.stats.peakHeapUsed,
      warningCount: monitor.stats.warningCount,
      criticalCount: monitor.stats.criticalCount
    };
  }

  /**
   * Calculate global memory average
   * @private
   */
  _calculateGlobalAverage() {
    if (this.history.length === 0) {
      return { rss: 0, heapUsed: 0 };
    }

    const sum = this.history.reduce((acc, m) => ({
      rss: acc.rss + m.rss,
      heapUsed: acc.heapUsed + m.heapUsed
    }), { rss: 0, heapUsed: 0 });

    return {
      rss: Math.round(sum.rss / this.history.length),
      heapUsed: Math.round(sum.heapUsed / this.history.length)
    };
  }

  /**
   * Calculate memory trend (increasing/stable/decreasing)
   * @private
   */
  _calculateMemoryTrend() {
    if (this.history.length < 10) {
      return 'insufficient-data';
    }

    // Compare recent average to older average
    const recent = this.history.slice(-10);
    const older = this.history.slice(-20, -10);

    const recentAvg = recent.reduce((sum, m) => sum + m.rss, 0) / recent.length;
    const olderAvg = older.reduce((sum, m) => sum + m.rss, 0) / older.length;

    const diff = recentAvg - olderAvg;
    const percentChange = (diff / olderAvg) * 100;

    if (percentChange > 10) return 'increasing';
    if (percentChange < -10) return 'decreasing';
    return 'stable';
  }

  /**
   * Generate resource cleanup recommendations
   * @private
   */
  _generateRecommendations() {
    const recommendations = [];
    const current = this._getCurrentMemory();
    const trend = this._calculateMemoryTrend();

    // High memory usage
    if (current.rss > CONSTANTS.MEMORY.WARNING_THRESHOLD_MB) {
      recommendations.push({
        severity: 'warning',
        message: `High memory usage detected: ${current.rss}MB RSS`,
        action: 'Consider stopping inactive monitors or triggering garbage collection'
      });
    }

    // Critical memory usage
    if (current.rss > CONSTANTS.MEMORY.CRITICAL_THRESHOLD_MB) {
      recommendations.push({
        severity: 'critical',
        message: `Critical memory usage: ${current.rss}MB RSS`,
        action: 'Stop non-essential operations immediately and investigate memory leak'
      });
    }

    // Memory increasing trend
    if (trend === 'increasing') {
      recommendations.push({
        severity: 'info',
        message: 'Memory usage is trending upward',
        action: 'Monitor for potential memory leaks or consider implementing memory limits'
      });
    }

    // Too many active monitors
    if (this.monitors.size > 5) {
      recommendations.push({
        severity: 'info',
        message: `${this.monitors.size} active memory monitors`,
        action: 'Review and stop monitors for completed operations'
      });
    }

    return recommendations;
  }

  /**
   * Format summary for logging
   * @private
   */
  _formatSummary(monitor, finalStats) {
    const lines = [
      `\n${'='.repeat(80)}`,
      `Memory Monitor Summary: ${monitor.id}`,
      `${'='.repeat(80)}`,
      `Runtime: ${Math.round(finalStats.runtime / 1000)}s`,
      `Total Measurements: ${finalStats.totalMeasurements}`,
      `Average RSS: ${finalStats.avgRss}MB`,
      `Average Heap: ${finalStats.avgHeapUsed}MB`,
      `Peak RSS: ${finalStats.peakRss}MB`,
      `Peak Heap: ${finalStats.peakHeapUsed}MB`,
      `Warnings: ${finalStats.warningCount}`,
      `Critical Alerts: ${finalStats.criticalCount}`,
      `${'='.repeat(80)}\n`
    ];

    return lines.join('\n');
  }

  /**
   * Force garbage collection if available
   */
  forceGarbageCollection() {
    if (global.gc) {
      console.log('🧹 Forcing garbage collection...');
      global.gc();
      return true;
    } else {
      console.warn('⚠️  Garbage collection not available (run with --expose-gc flag)');
      return false;
    }
  }

  /**
   * Get service statistics
   *
   * @returns {Object} Service usage statistics
   */
  getStats() {
    return {
      activeMonitors: this.monitors.size,
      totalHistorySize: this.history.length,
      uptime: Date.now() - this.startTime,
      peakMemory: this.peakMemory,
      currentMemory: this._getCurrentMemory()
    };
  }
}

// Singleton instance
module.exports = new MemoryMonitorService();
