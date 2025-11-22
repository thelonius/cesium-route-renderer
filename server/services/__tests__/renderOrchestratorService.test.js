const renderOrchestratorService = require('../renderOrchestratorService');

// Mock dependencies
jest.mock('../dockerService');
jest.mock('../memoryMonitorService');
jest.mock('../routeAnalyzerService');
jest.mock('../gpxService');

describe('RenderOrchestratorService', () => {
  let mockCallbacks;

  beforeEach(() => {
    mockCallbacks = {
      onProgress: jest.fn(),
      onStageChange: jest.fn(),
      onError: jest.fn(),
      onComplete: jest.fn()
    };

    jest.clearAllMocks();
  });

  describe('startRender', () => {
    test('executes all pipeline stages in order', async () => {
      const config = {
        gpxPath: '/path/to/route.gpx',
        outputId: 'test-123',
        userName: 'TestUser'
      };

      const dockerService = require('../dockerService');
      dockerService.runContainer.mockResolvedValue({ success: true });

      await renderOrchestratorService.startRender(config, mockCallbacks);

      expect(mockCallbacks.onStageChange).toHaveBeenCalledWith('analysis', expect.any(Object));
      expect(mockCallbacks.onStageChange).toHaveBeenCalledWith('preparation', expect.any(Object));
      expect(mockCallbacks.onStageChange).toHaveBeenCalledWith('execution', expect.any(Object));
      expect(mockCallbacks.onStageChange).toHaveBeenCalledWith('validation', expect.any(Object));
      expect(mockCallbacks.onStageChange).toHaveBeenCalledWith('completion', expect.any(Object));
    });

    test('reports progress from 0 to 100', async () => {
      const config = {
        gpxPath: '/path/to/route.gpx',
        outputId: 'test-123',
        userName: 'TestUser'
      };

      const dockerService = require('../dockerService');
      dockerService.runContainer.mockResolvedValue({ success: true });

      await renderOrchestratorService.startRender(config, mockCallbacks);

      const progressCalls = mockCallbacks.onProgress.mock.calls.map(call => call[0]);

      expect(Math.min(...progressCalls)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...progressCalls)).toBeLessThanOrEqual(100);
      expect(progressCalls[progressCalls.length - 1]).toBe(100);
    });

    test('calls onError when stage fails', async () => {
      const config = {
        gpxPath: '/invalid/path.gpx',
        outputId: 'test-456',
        userName: 'TestUser'
      };

      const gpxService = require('../gpxService');
      gpxService.parseGPX.mockRejectedValue(new Error('File not found'));

      await renderOrchestratorService.startRender(config, mockCallbacks);

      expect(mockCallbacks.onError).toHaveBeenCalledWith(
        expect.objectContaining({
          stage: 'analysis',
          error: expect.any(String)
        })
      );
    });

    test('tracks active render during execution', async () => {
      const config = {
        gpxPath: '/path/to/route.gpx',
        outputId: 'test-789',
        userName: 'TestUser'
      };

      const dockerService = require('../dockerService');
      dockerService.runContainer.mockImplementation(() => {
        return new Promise(resolve => setTimeout(() => resolve({ success: true }), 100));
      });

      const renderPromise = renderOrchestratorService.startRender(config, mockCallbacks);

      // Check during execution
      const activeRenders = renderOrchestratorService.getActiveRenders();
      expect(activeRenders.some(r => r.outputId === 'test-789')).toBe(true);

      await renderPromise;

      // Check after completion
      const activeRendersAfter = renderOrchestratorService.getActiveRenders();
      expect(activeRendersAfter.some(r => r.outputId === 'test-789')).toBe(false);
    });
  });

  describe('getRenderStatus', () => {
    test('returns null for non-existent render', () => {
      const status = renderOrchestratorService.getRenderStatus('non-existent-id');

      expect(status).toBeNull();
    });

    test('returns current stage and progress for active render', async () => {
      const config = {
        gpxPath: '/path/to/route.gpx',
        outputId: 'test-status',
        userName: 'TestUser'
      };

      const dockerService = require('../dockerService');
      dockerService.runContainer.mockImplementation(() => {
        return new Promise(resolve => setTimeout(() => resolve({ success: true }), 200));
      });

      renderOrchestratorService.startRender(config, mockCallbacks);

      // Wait a bit for render to start
      await new Promise(resolve => setTimeout(resolve, 50));

      const status = renderOrchestratorService.getRenderStatus('test-status');

      expect(status).toMatchObject({
        outputId: 'test-status',
        stage: expect.any(String),
        progress: expect.any(Number),
        startTime: expect.any(Number)
      });
    });
  });

  describe('cancelRender', () => {
    test('stops active render and cleans up', async () => {
      const config = {
        gpxPath: '/path/to/route.gpx',
        outputId: 'test-cancel',
        userName: 'TestUser'
      };

      const dockerService = require('../dockerService');
      let containerRunning = true;
      dockerService.runContainer.mockImplementation(() => {
        return new Promise(resolve => {
          const checkCancel = setInterval(() => {
            if (!containerRunning) {
              clearInterval(checkCancel);
              resolve({ success: false, cancelled: true });
            }
          }, 50);
        });
      });
      dockerService.stopContainer.mockImplementation(() => {
        containerRunning = false;
        return Promise.resolve({ success: true });
      });

      renderOrchestratorService.startRender(config, mockCallbacks);

      await new Promise(resolve => setTimeout(resolve, 100));

      const result = await renderOrchestratorService.cancelRender('test-cancel');

      expect(result.success).toBe(true);
      expect(dockerService.stopContainer).toHaveBeenCalled();

      const activeRenders = renderOrchestratorService.getActiveRenders();
      expect(activeRenders.some(r => r.outputId === 'test-cancel')).toBe(false);
    });

    test('returns false when canceling non-existent render', async () => {
      const result = await renderOrchestratorService.cancelRender('non-existent');

      expect(result.success).toBe(false);
    });
  });

  describe('getActiveRenders', () => {
    test('returns empty array when no renders active', () => {
      const activeRenders = renderOrchestratorService.getActiveRenders();

      expect(Array.isArray(activeRenders)).toBe(true);
      expect(activeRenders.length).toBe(0);
    });

    test('returns all active renders with correct data', async () => {
      const config1 = {
        gpxPath: '/path/to/route1.gpx',
        outputId: 'test-active-1',
        userName: 'User1'
      };
      const config2 = {
        gpxPath: '/path/to/route2.gpx',
        outputId: 'test-active-2',
        userName: 'User2'
      };

      const dockerService = require('../dockerService');
      dockerService.runContainer.mockImplementation(() => {
        return new Promise(resolve => setTimeout(() => resolve({ success: true }), 500));
      });

      renderOrchestratorService.startRender(config1, mockCallbacks);
      renderOrchestratorService.startRender(config2, mockCallbacks);

      await new Promise(resolve => setTimeout(resolve, 100));

      const activeRenders = renderOrchestratorService.getActiveRenders();

      expect(activeRenders.length).toBe(2);
      expect(activeRenders.some(r => r.outputId === 'test-active-1')).toBe(true);
      expect(activeRenders.some(r => r.outputId === 'test-active-2')).toBe(true);
    });
  });

  describe('Stage transitions', () => {
    test('analysis stage calculates route metrics correctly', async () => {
      const config = {
        gpxPath: '/path/to/route.gpx',
        outputId: 'test-analysis',
        userName: 'TestUser'
      };

      const routeAnalyzerService = require('../routeAnalyzerService');
      routeAnalyzerService.analyzeRoute.mockResolvedValue({
        statistics: {
          distance: { total: 5000 },
          elevation: { gain: 500 },
          duration: { minutes: 180 }
        },
        pattern: 'technical_climb'
      });

      await renderOrchestratorService.startRender(config, mockCallbacks);

      expect(routeAnalyzerService.analyzeRoute).toHaveBeenCalled();
      expect(mockCallbacks.onStageChange).toHaveBeenCalledWith(
        'analysis',
        expect.objectContaining({
          progress: expect.any(Number),
          data: expect.objectContaining({
            pattern: 'technical_climb'
          })
        })
      );
    });

    test('preparation stage validates files and directories', async () => {
      const config = {
        gpxPath: '/path/to/route.gpx',
        outputId: 'test-prep',
        userName: 'TestUser'
      };

      await renderOrchestratorService.startRender(config, mockCallbacks);

      const prepStageCall = mockCallbacks.onStageChange.mock.calls.find(
        call => call[0] === 'preparation'
      );

      expect(prepStageCall).toBeDefined();
      expect(prepStageCall[1]).toMatchObject({
        progress: expect.any(Number),
        message: expect.any(String)
      });
    });

    test('execution stage monitors Docker container', async () => {
      const config = {
        gpxPath: '/path/to/route.gpx',
        outputId: 'test-exec',
        userName: 'TestUser'
      };

      const dockerService = require('../dockerService');
      const mockOnProgress = jest.fn();
      dockerService.runContainer.mockImplementation((cfg, callbacks) => {
        // Simulate progress updates
        setTimeout(() => callbacks.onProgress?.(30), 50);
        setTimeout(() => callbacks.onProgress?.(60), 100);
        setTimeout(() => callbacks.onProgress?.(90), 150);
        return new Promise(resolve => setTimeout(() => resolve({ success: true }), 200));
      });

      await renderOrchestratorService.startRender(config, mockCallbacks);

      expect(dockerService.runContainer).toHaveBeenCalled();
      expect(mockCallbacks.onProgress.mock.calls.length).toBeGreaterThan(3);
    });

    test('validation stage checks output file existence', async () => {
      const config = {
        gpxPath: '/path/to/route.gpx',
        outputId: 'test-validate',
        userName: 'TestUser'
      };

      await renderOrchestratorService.startRender(config, mockCallbacks);

      const validationCall = mockCallbacks.onStageChange.mock.calls.find(
        call => call[0] === 'validation'
      );

      expect(validationCall).toBeDefined();
    });

    test('completion stage triggers onComplete callback', async () => {
      const config = {
        gpxPath: '/path/to/route.gpx',
        outputId: 'test-complete',
        userName: 'TestUser'
      };

      await renderOrchestratorService.startRender(config, mockCallbacks);

      expect(mockCallbacks.onComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          outputId: 'test-complete',
          success: true
        })
      );
    });
  });
});
