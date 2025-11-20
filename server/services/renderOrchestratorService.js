const fs = require('fs');
const path = require('path');
const routeAnalyzerService = require('./routeAnalyzerService');
const dockerService = require('./dockerService');
const settingsService = require('./settingsService');
const renderingConfig = require('../../config/rendering');

/**
 * Render Orchestrator Service
 *
 * High-level service that coordinates all aspects of route video rendering:
 * - Route analysis (pattern detection, speed calculation, overlays)
 * - Docker container execution and monitoring
 * - Memory monitoring and resource management
 * - Progress tracking and status updates
 * - Output validation and metadata generation
 * - Error handling and cleanup
 *
 * This service provides a single entry point for the /render-route endpoint,
 * abstracting away the complexity of coordinating multiple lower-level services.
 */
class RenderOrchestratorService {
  constructor() {
    this.activeRenders = new Map(); // Track active render operations
  }

  /**
   * Start a complete render operation
   *
   * @param {Object} config - Render configuration
   * @param {Object} callbacks - Progress and completion callbacks
   * @returns {Object} Render operation control object
   */
  async startRender(config, callbacks = {}) {
    const {
      routeFilePath,
      routeFilename,
      outputDir,
      outputId,
      userName = 'telegram-user'
    } = config;

    const {
      onProgress = () => {},
      onComplete = () => {},
      onError = () => {}
    } = callbacks;

    const renderId = outputId;
    const startTime = Date.now();

    // Initialize render tracking
    const renderState = {
      id: renderId,
      status: 'analyzing',
      startTime,
      routeFilePath,
      outputDir,
      outputId,
      progress: 0,
      currentStage: 'route-analysis',
      error: null,
      routeProfile: null,
      dockerContainer: null,
      memoryStats: null
    };

    this.activeRenders.set(renderId, renderState);

    try {
      // Stage 1: Route Analysis
      console.log(`\n${'='.repeat(80)}`);
      console.log(`🎬 Starting render operation: ${renderId}`);
      console.log(`${'='.repeat(80)}\n`);

      renderState.status = 'analyzing';
      renderState.progress = 10;
      onProgress({ stage: 'route-analysis', progress: 10, message: 'Analyzing route...' });

      const settings = settingsService.load();
      const routeProfile = routeAnalyzerService.analyzeComplete(routeFilePath, settings);

      if (!routeProfile.success) {
        throw new Error(`Route analysis failed: ${routeProfile.error || 'Unknown error'}`);
      }

      renderState.routeProfile = routeProfile;
      renderState.progress = 20;
      onProgress({ stage: 'route-analysis', progress: 20, message: 'Route analyzed successfully' });

      // Log analysis results
      this._logAnalysisResults(routeProfile, outputDir);

      // Stage 2: Prepare render configuration
      renderState.currentStage = 'preparation';
      renderState.progress = 25;
      onProgress({ stage: 'preparation', progress: 25, message: 'Preparing render configuration...' });

      const renderConfig = this._prepareRenderConfig(routeProfile, config, settings);

      // Save metadata files
      this._saveMetadataFiles(routeProfile, renderConfig, outputDir);

      renderState.progress = 30;
      onProgress({ stage: 'preparation', progress: 30, message: 'Configuration prepared' });

      // Stage 3: Execute Docker render
      renderState.currentStage = 'rendering';
      renderState.status = 'rendering';
      renderState.progress = 35;
      onProgress({ stage: 'rendering', progress: 35, message: 'Starting Docker container...' });

      const dockerResult = await this._executeDockerRender(
        renderConfig,
        renderState,
        onProgress
      );

      // Stage 4: Validate output
      renderState.currentStage = 'validation';
      renderState.progress = 90;
      onProgress({ stage: 'validation', progress: 90, message: 'Validating output...' });

      const validation = this._validateOutput(outputDir, dockerResult);

      if (!validation.success) {
        throw new Error(validation.error);
      }

      // Stage 5: Complete
      renderState.status = 'complete';
      renderState.progress = 100;
      renderState.currentStage = 'complete';

      const completionData = this._buildCompletionData(
        renderConfig,
        validation,
        dockerResult,
        startTime
      );

      console.log(`\n${'='.repeat(80)}`);
      console.log(`✅ Render complete: ${renderId}`);
      console.log(`   Duration: ${Math.round((Date.now() - startTime) / 1000)}s`);
      console.log(`   Video size: ${(validation.videoStats.size / 1024 / 1024).toFixed(2)}MB`);
      console.log(`${'='.repeat(80)}\n`);

      this.activeRenders.delete(renderId);
      onComplete(completionData);

      return completionData;

    } catch (error) {
      console.error(`❌ Render failed: ${renderId}`, error);

      renderState.status = 'failed';
      renderState.error = error.message;
      renderState.progress = 0;

      const errorData = {
        success: false,
        error: error.message,
        outputId,
        stage: renderState.currentStage,
        duration: Date.now() - startTime
      };

      this.activeRenders.delete(renderId);
      onError(errorData);

      return errorData;
    }
  }

  /**
   * Get status of an active render
   *
   * @param {string} renderId - Render ID
   * @returns {Object|null} Render status
   */
  getRenderStatus(renderId) {
    const renderState = this.activeRenders.get(renderId);
    if (!renderState) {
      return null;
    }

    return {
      id: renderState.id,
      status: renderState.status,
      progress: renderState.progress,
      currentStage: renderState.currentStage,
      elapsed: Date.now() - renderState.startTime,
      error: renderState.error
    };
  }

  /**
   * Cancel an active render
   *
   * @param {string} renderId - Render ID
   * @returns {boolean} Success
   */
  cancelRender(renderId) {
    const renderState = this.activeRenders.get(renderId);
    if (!renderState) {
      return false;
    }

    // Stop Docker container if running
    if (renderState.dockerContainer) {
      dockerService.stopContainer(renderState.dockerContainer.id);
    }

    renderState.status = 'cancelled';
    this.activeRenders.delete(renderId);

    return true;
  }

  /**
   * Get all active renders
   *
   * @returns {Array} Active render statuses
   */
  getActiveRenders() {
    return Array.from(this.activeRenders.values()).map(state => ({
      id: state.id,
      status: state.status,
      progress: state.progress,
      currentStage: state.currentStage,
      elapsed: Date.now() - state.startTime
    }));
  }

  /**
   * Log route analysis results
   * @private
   */
  _logAnalysisResults(routeProfile, outputDir) {
    const logPath = path.join(outputDir, 'recorder.log');

    console.log(`🎬 Animation speed: ${routeProfile.speed.value}x - ${routeProfile.speed.reason}`);

    if (routeProfile.pattern.type !== 'unknown') {
      console.log(`🗺️  Route pattern: ${routeProfile.pattern.type} (${(routeProfile.pattern.confidence * 100).toFixed(0)}% confidence)`);
      console.log(`   ${routeProfile.pattern.description}`);
    }

    console.log(`📊 Generated ${routeProfile.overlays.hooks.length} overlay hooks for video`);
    console.log(`⚡ Analysis completed in ${routeProfile.metadata.analysisTime}ms`);

    // Write to log file
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] 🐳 Starting render operation...\n`);
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] Animation speed: ${routeProfile.speed.value}x\n`);
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] Route pattern: ${routeProfile.pattern.type} (${(routeProfile.pattern.confidence * 100).toFixed(0)}% confidence)\n`);
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] Overlay hooks: ${routeProfile.overlays.hooks.length} generated\n`);
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] Analysis time: ${routeProfile.metadata.analysisTime}ms\n`);
  }

  /**
   * Prepare render configuration
   * @private
   */
  _prepareRenderConfig(routeProfile, config, settings) {
    const routeAnalysis = routeProfile.route;
    const animationSpeed = routeProfile.speed.value;

    // Calculate video duration
    let videoDurationSeconds = null;
    let routeDurationMinutes = null;
    const routeDurationSeconds = routeAnalysis.duration?.seconds || null;

    if (routeDurationSeconds) {
      videoDurationSeconds = renderingConfig.calculateVideoDuration(routeDurationSeconds, animationSpeed);
      routeDurationMinutes = (routeDurationSeconds / 60).toFixed(1);
      const videoDurationMinutes = (videoDurationSeconds / 60).toFixed(1);
      console.log(`📹 Route duration: ${routeDurationMinutes} min | Video duration: ${videoDurationMinutes} min | Speed: ${animationSpeed}x`);
    }

    // Get recording settings
    const dockerRecordFps = String(settings.recording?.fps || 30);
    const dockerRecordWidth = String(settings.recording?.width || 720);
    const dockerRecordHeight = String(settings.recording?.height || 1280);

    return {
      routeProfile,
      routeAnalysis,
      animationSpeed,
      videoDurationSeconds,
      routeDurationMinutes,
      routeDurationSeconds,
      recording: {
        fps: dockerRecordFps,
        width: dockerRecordWidth,
        height: dockerRecordHeight
      },
      paths: {
        routeFile: config.routeFilePath,
        routeFilename: config.routeFilename,
        outputDir: config.outputDir,
        outputId: config.outputId
      },
      userName: config.userName
    };
  }

  /**
   * Save metadata files
   * @private
   */
  _saveMetadataFiles(routeProfile, renderConfig, outputDir) {
    const overlayDataPath = path.join(outputDir, 'overlay-data.json');
    const routeAnalysis = routeProfile.route;

    fs.writeFileSync(overlayDataPath, JSON.stringify({
      overlayHooks: routeProfile.overlays,
      routePattern: routeProfile.pattern,
      routeMetadata: {
        distance: routeAnalysis.distance,
        elevation: routeAnalysis.elevation,
        terrain: routeAnalysis.terrain,
        routeType: routeAnalysis.routeType,
        metadata: routeAnalysis.metadata
      },
      camera: routeProfile.camera,
      animationSpeed: renderConfig.animationSpeed,
      videoDuration: renderConfig.videoDurationSeconds,
      analysisTime: routeProfile.metadata.analysisTime,
      generatedAt: new Date().toISOString()
    }, null, 2));
  }

  /**
   * Execute Docker render with progress tracking
   * @private
   */
  _executeDockerRender(renderConfig, renderState, onProgress) {
    return new Promise((resolve, reject) => {
      const logPath = path.join(renderConfig.paths.outputDir, 'recorder.log');

      let dockerOutputs = {
        stdout: '',
        stderr: '',
        memoryStats: null,
        duration: 0,
        exitCode: null
      };

      const containerInfo = dockerService.runContainer(
        {
          gpxPath: path.resolve(renderConfig.paths.routeFile),
          gpxFilename: renderConfig.paths.routeFilename,
          outputDir: path.resolve(renderConfig.paths.outputDir),
          animationSpeed: renderConfig.animationSpeed,
          userName: renderConfig.userName,
          recording: renderConfig.recording,
          logPath
        },
        {
          onStdout: (text) => {
            dockerOutputs.stdout += text;
            // Track progress from Docker output (optional enhancement)
            this._updateProgressFromDockerOutput(text, renderState, onProgress);
          },
          onStderr: (text) => {
            dockerOutputs.stderr += text;
          },
          onMemoryWarning: ({ rss }) => {
            console.warn(`⚠️  High memory usage during render: ${rss}MB`);
            onProgress({
              stage: 'rendering',
              progress: renderState.progress,
              message: `Rendering... (Memory: ${rss}MB)`,
              memoryWarning: true
            });
          },
          onError: (error, { stdout, stderr, memoryStats }) => {
            dockerOutputs.stdout = stdout;
            dockerOutputs.stderr = stderr;
            dockerOutputs.memoryStats = memoryStats;
            reject(new Error(`Docker error: ${error.message}`));
          },
          onClose: (code, { stdout, stderr, memoryStats, duration }) => {
            dockerOutputs.stdout = stdout;
            dockerOutputs.stderr = stderr;
            dockerOutputs.memoryStats = memoryStats;
            dockerOutputs.duration = duration;
            dockerOutputs.exitCode = code;

            if (code !== 0) {
              reject(new Error(`Docker exited with code ${code}`));
            } else {
              resolve(dockerOutputs);
            }
          }
        }
      );

      renderState.dockerContainer = containerInfo;
    });
  }

  /**
   * Update progress based on Docker output
   * @private
   */
  _updateProgressFromDockerOutput(text, renderState, onProgress) {
    // Parse Docker output for progress indicators
    // Example: "📹 Frame 150/300 (50%)" -> 50% progress

    // Simple heuristic: map Docker progress to overall progress (35-85%)
    const frameMatch = text.match(/Frame\s+(\d+)\/(\d+)/);
    if (frameMatch) {
      const current = parseInt(frameMatch[1], 10);
      const total = parseInt(frameMatch[2], 10);
      const dockerProgress = (current / total) * 100;

      // Map 0-100% Docker progress to 35-85% overall progress
      const overallProgress = 35 + (dockerProgress * 0.5);
      renderState.progress = Math.round(overallProgress);

      onProgress({
        stage: 'rendering',
        progress: renderState.progress,
        message: `Rendering frame ${current}/${total}...`
      });
    }
  }

  /**
   * Validate render output
   * @private
   */
  _validateOutput(outputDir, dockerResult) {
    const videoPath = path.join(outputDir, 'route-video.mp4');

    if (!fs.existsSync(videoPath)) {
      return {
        success: false,
        error: 'Video file not created',
        dockerOutputs: {
          stdout: dockerService.trimOutput(dockerResult.stdout),
          stderr: dockerService.trimOutput(dockerResult.stderr)
        }
      };
    }

    const videoStats = fs.statSync(videoPath);

    // Check if file has content
    if (videoStats.size === 0) {
      return {
        success: false,
        error: 'Video file is empty',
        dockerOutputs: {
          stdout: dockerService.trimOutput(dockerResult.stdout),
          stderr: dockerService.trimOutput(dockerResult.stderr)
        }
      };
    }

    return {
      success: true,
      videoPath,
      videoStats,
      dockerOutputs: dockerResult
    };
  }

  /**
   * Build completion data for response
   * @private
   */
  _buildCompletionData(renderConfig, validation, dockerResult, startTime) {
    const routeProfile = renderConfig.routeProfile;
    const routeAnalysis = renderConfig.routeAnalysis;

    return {
      success: true,
      videoUrl: `/output/${renderConfig.paths.outputId}/route-video.mp4`,
      outputId: renderConfig.paths.outputId,
      fileSize: validation.videoStats.size,
      animationSpeed: renderConfig.animationSpeed,
      videoDurationSeconds: renderConfig.videoDurationSeconds,
      routeDurationMinutes: renderConfig.routeDurationMinutes,
      videoWidth: parseInt(renderConfig.recording.width, 10),
      videoHeight: parseInt(renderConfig.recording.height, 10),
      routePattern: routeProfile.pattern,
      overlayHooks: routeProfile.overlays,
      routeMetadata: {
        distance: routeAnalysis.distance,
        elevation: routeAnalysis.elevation,
        terrain: routeAnalysis.terrain,
        routeType: routeAnalysis.routeType,
        metadata: routeAnalysis.metadata
      },
      camera: routeProfile.camera,
      analysisTime: routeProfile.metadata.analysisTime,
      renderTime: Date.now() - startTime,
      memoryStats: dockerResult.memoryStats,
      logsUrl: `/logs/${renderConfig.paths.outputId}`,
      logsTextUrl: `/logs/${renderConfig.paths.outputId}/text`
    };
  }

  /**
   * Get service statistics
   *
   * @returns {Object} Service usage statistics
   */
  getStats() {
    return {
      activeRenders: this.activeRenders.size,
      rendersList: this.getActiveRenders()
    };
  }
}

// Singleton instance
module.exports = new RenderOrchestratorService();
