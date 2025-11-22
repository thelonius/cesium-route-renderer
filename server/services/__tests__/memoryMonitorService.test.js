const memoryMonitorService = require('../memoryMonitorService');

describe('MemoryMonitorService', () => {
  beforeEach(() => {
    // Clean up any existing monitors
    memoryMonitorService.stopAllMonitors();
  });

  afterEach(() => {
    memoryMonitorService.stopAllMonitors();
  });

  describe('createMonitor', () => {
    test('creates new monitor with unique ID', () => {
      const monitor1 = memoryMonitorService.createMonitor('test-1');
      const monitor2 = memoryMonitorService.createMonitor('test-2');

      expect(monitor1.monitorId).toBe('test-1');
      expect(monitor2.monitorId).toBe('test-2');
    });

    test('applies custom thresholds', () => {
      const monitor = memoryMonitorService.createMonitor('test-thresholds', {
        warningThreshold: 1000,
        criticalThreshold: 2000
      });

      expect(monitor.options.warningThreshold).toBe(1000);
      expect(monitor.options.criticalThreshold).toBe(2000);
    });

    test('starts monitoring immediately', (done) => {
      const onMeasurement = jest.fn();

      memoryMonitorService.createMonitor('test-immediate', {
        onMeasurement,
        interval: 100
      });

      setTimeout(() => {
        expect(onMeasurement).toHaveBeenCalled();
        done();
      }, 250);
    });

    test('throws error when creating monitor with duplicate ID', () => {
      memoryMonitorService.createMonitor('test-duplicate');

      expect(() => {
        memoryMonitorService.createMonitor('test-duplicate');
      }).toThrow();
    });
  });

  describe('stopMonitor', () => {
    test('stops monitoring and returns final statistics', () => {
      memoryMonitorService.createMonitor('test-stop');

      const stats = memoryMonitorService.stopMonitor('test-stop');

      expect(stats).toMatchObject({
        monitorId: 'test-stop',
        totalMeasurements: expect.any(Number),
        averageMemory: expect.any(Number),
        peakMemory: expect.any(Number)
      });
    });

    test('returns null for non-existent monitor', () => {
      const stats = memoryMonitorService.stopMonitor('non-existent');

      expect(stats).toBeNull();
    });

    test('cleans up resources after stop', () => {
      memoryMonitorService.createMonitor('test-cleanup');
      memoryMonitorService.stopMonitor('test-cleanup');

      const activeMonitors = memoryMonitorService.getActiveMonitors();
      expect(activeMonitors.some(m => m.monitorId === 'test-cleanup')).toBe(false);
    });
  });

  describe('Memory measurement', () => {
    test('records memory usage over time', (done) => {
      const measurements = [];

      memoryMonitorService.createMonitor('test-measurements', {
        interval: 100,
        onMeasurement: (data) => {
          measurements.push(data);
        }
      });

      setTimeout(() => {
        memoryMonitorService.stopMonitor('test-measurements');

        expect(measurements.length).toBeGreaterThan(2);
        expect(measurements[0]).toMatchObject({
          timestamp: expect.any(Number),
          heapUsed: expect.any(Number),
          heapTotal: expect.any(Number),
          rss: expect.any(Number)
        });

        done();
      }, 350);
    });

    test('tracks peak memory correctly', (done) => {
      let peakSeen = 0;

      memoryMonitorService.createMonitor('test-peak', {
        interval: 50,
        onMeasurement: (data) => {
          if (data.heapUsed > peakSeen) {
            peakSeen = data.heapUsed;
          }
        }
      });

      setTimeout(() => {
        const stats = memoryMonitorService.stopMonitor('test-peak');

        expect(stats.peakMemory).toBeGreaterThanOrEqual(peakSeen);
        done();
      }, 200);
    });
  });

  describe('Threshold detection', () => {
    test('triggers warning callback when exceeding warning threshold', (done) => {
      const onWarning = jest.fn();

      memoryMonitorService.createMonitor('test-warning', {
        warningThreshold: 1, // 1MB - will definitely exceed
        criticalThreshold: 10000,
        onWarning,
        interval: 100
      });

      setTimeout(() => {
        memoryMonitorService.stopMonitor('test-warning');
        expect(onWarning).toHaveBeenCalled();
        done();
      }, 250);
    });

    test('triggers critical callback when exceeding critical threshold', (done) => {
      const onCritical = jest.fn();

      memoryMonitorService.createMonitor('test-critical', {
        warningThreshold: 1,
        criticalThreshold: 1, // 1MB - will definitely exceed
        onCritical,
        interval: 100
      });

      setTimeout(() => {
        memoryMonitorService.stopMonitor('test-critical');
        expect(onCritical).toHaveBeenCalled();
        done();
      }, 250);
    });

    test('does not trigger callbacks when below thresholds', (done) => {
      const onWarning = jest.fn();
      const onCritical = jest.fn();

      memoryMonitorService.createMonitor('test-no-trigger', {
        warningThreshold: 10000, // 10GB - won't exceed
        criticalThreshold: 20000,
        onWarning,
        onCritical,
        interval: 100
      });

      setTimeout(() => {
        memoryMonitorService.stopMonitor('test-no-trigger');
        expect(onWarning).not.toHaveBeenCalled();
        expect(onCritical).not.toHaveBeenCalled();
        done();
      }, 250);
    });
  });

  describe('Trend analysis', () => {
    test('detects increasing memory trend', (done) => {
      const measurements = [];
      let arrayLeak = [];

      memoryMonitorService.createMonitor('test-trend-up', {
        interval: 50,
        onMeasurement: (data) => {
          measurements.push(data.heapUsed);
          // Simulate memory leak
          arrayLeak.push(new Array(1000).fill('data'));
        }
      });

      setTimeout(() => {
        const stats = memoryMonitorService.stopMonitor('test-trend-up');

        // Check that later measurements are generally higher
        const firstHalf = measurements.slice(0, Math.floor(measurements.length / 2));
        const secondHalf = measurements.slice(Math.floor(measurements.length / 2));

        const avgFirst = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
        const avgSecond = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

        expect(avgSecond).toBeGreaterThan(avgFirst);
        arrayLeak = null; // Clean up
        done();
      }, 300);
    });

    test('calculates moving average correctly', (done) => {
      const movingAverages = [];

      memoryMonitorService.createMonitor('test-moving-avg', {
        interval: 50,
        movingAverageWindow: 3,
        onMeasurement: (data) => {
          if (data.movingAverage !== undefined) {
            movingAverages.push(data.movingAverage);
          }
        }
      });

      setTimeout(() => {
        memoryMonitorService.stopMonitor('test-moving-avg');

        expect(movingAverages.length).toBeGreaterThan(0);
        movingAverages.forEach(avg => {
          expect(avg).toBeGreaterThan(0);
          expect(Number.isFinite(avg)).toBe(true);
        });

        done();
      }, 250);
    });
  });

  describe('getGlobalStats', () => {
    test('returns system-wide memory statistics', () => {
      const stats = memoryMonitorService.getGlobalStats();

      expect(stats).toMatchObject({
        heapUsed: expect.any(Number),
        heapTotal: expect.any(Number),
        rss: expect.any(Number),
        external: expect.any(Number)
      });
    });

    test('global stats show reasonable values', () => {
      const stats = memoryMonitorService.getGlobalStats();

      expect(stats.heapUsed).toBeGreaterThan(0);
      expect(stats.heapTotal).toBeGreaterThan(stats.heapUsed);
      expect(stats.rss).toBeGreaterThan(stats.heapTotal);
    });
  });

  describe('getActiveMonitors', () => {
    test('returns list of all active monitors', () => {
      memoryMonitorService.createMonitor('test-active-1');
      memoryMonitorService.createMonitor('test-active-2');
      memoryMonitorService.createMonitor('test-active-3');

      const activeMonitors = memoryMonitorService.getActiveMonitors();

      expect(activeMonitors.length).toBe(3);
      expect(activeMonitors.map(m => m.monitorId)).toContain('test-active-1');
      expect(activeMonitors.map(m => m.monitorId)).toContain('test-active-2');
      expect(activeMonitors.map(m => m.monitorId)).toContain('test-active-3');
    });

    test('returns empty array when no monitors active', () => {
      const activeMonitors = memoryMonitorService.getActiveMonitors();

      expect(Array.isArray(activeMonitors)).toBe(true);
      expect(activeMonitors.length).toBe(0);
    });
  });

  describe('stopAllMonitors', () => {
    test('stops all active monitors', () => {
      memoryMonitorService.createMonitor('test-stop-all-1');
      memoryMonitorService.createMonitor('test-stop-all-2');
      memoryMonitorService.createMonitor('test-stop-all-3');

      const stats = memoryMonitorService.stopAllMonitors();

      expect(stats.length).toBe(3);

      const activeMonitors = memoryMonitorService.getActiveMonitors();
      expect(activeMonitors.length).toBe(0);
    });

    test('returns statistics for all stopped monitors', () => {
      memoryMonitorService.createMonitor('test-stats-1');
      memoryMonitorService.createMonitor('test-stats-2');

      const stats = memoryMonitorService.stopAllMonitors();

      expect(stats).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ monitorId: 'test-stats-1' }),
          expect.objectContaining({ monitorId: 'test-stats-2' })
        ])
      );
    });
  });

  describe('Cleanup recommendations', () => {
    test('provides cleanup recommendations when memory is high', (done) => {
      let recommendationGiven = false;

      memoryMonitorService.createMonitor('test-recommendations', {
        warningThreshold: 1,
        interval: 100,
        onWarning: (data) => {
          if (data.recommendations && data.recommendations.length > 0) {
            recommendationGiven = true;
          }
        }
      });

      setTimeout(() => {
        memoryMonitorService.stopMonitor('test-recommendations');
        expect(recommendationGiven).toBe(true);
        done();
      }, 250);
    });
  });

  describe('Historical data retention', () => {
    test('limits historical measurements to max window size', (done) => {
      const maxHistory = 10;

      memoryMonitorService.createMonitor('test-history', {
        interval: 20,
        maxHistorySize: maxHistory
      });

      setTimeout(() => {
        const stats = memoryMonitorService.stopMonitor('test-history');

        expect(stats.totalMeasurements).toBeGreaterThan(maxHistory);
        // Historical data should be capped
        if (stats.history) {
          expect(stats.history.length).toBeLessThanOrEqual(maxHistory);
        }

        done();
      }, 300);
    });
  });
});
