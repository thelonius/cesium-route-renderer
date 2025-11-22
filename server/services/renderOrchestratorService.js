const routeAnalyzerService = require('./routeAnalyzerService');
const dockerService = require('./dockerService');
const settingsService = require('./settingsService');

// Orchestrator modules
const metadataBuilder = require('./orchestrator/metadataBuilder');
const configBuilder = require('./orchestrator/configBuilder');
const outputValidator = require('./orchestrator/outputValidator');
const progressTracker = require('./orchestrator/progressTracker');
const dockerExecutor = require('./orchestrator/dockerExecutor');
const { STAGES } = require('./orchestrator/pipelineStages');

/**
 * Render Orchestrator Service
 *
 * High-level coordinator that manages the 5-stage render pipeline:
 * 1. Route Analysis - Pattern detection, speed calculation, overlays
 * 2. Preparation - Configuration and metadata preparation
 * 3. Rendering - Docker container execution with progress tracking
 * 4. Validation - Output verification
 * 5. Completion - Final metadata and response generation
 *
 * This service provides a single entry point for the /render-route endpoint,
 * delegating specific concerns to focused orchestrator modules.
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
      renderState.progress = STAGES.ROUTE_ANALYSIS.progressStart;
      onProgress({
        stage: STAGES.ROUTE_ANALYSIS.name,
        progress: STAGES.ROUTE_ANALYSIS.progressStart,
        message: STAGES.ROUTE_ANALYSIS.description
      });

      const settings = settingsService.load();
      const routeProfile = routeAnalyzerService.analyzeComplete(routeFilePath, settings);

      if (!routeProfile.success) {
        throw new Error(`Route analysis failed: ${routeProfile.error || 'Unknown error'}`);
      }

      renderState.routeProfile = routeProfile;
      renderState.progress = STAGES.ROUTE_ANALYSIS.progressEnd;
      onProgress({
        stage: STAGES.ROUTE_ANALYSIS.name,
        progress: STAGES.ROUTE_ANALYSIS.progressEnd,
        message: 'Route analyzed successfully'
      });

      // Log analysis results using metadata builder
      metadataBuilder.logAnalysisResults(routeProfile, outputDir);

      // Stage 2: Prepare render configuration
      renderState.currentStage = STAGES.PREPARATION.name;
      renderState.progress = STAGES.PREPARATION.progressStart;
      onProgress({
        stage: STAGES.PREPARATION.name,
        progress: STAGES.PREPARATION.progressStart,
        message: STAGES.PREPARATION.description
      });

      const renderConfig = configBuilder.prepareRenderConfig(routeProfile, config, settings);

      // Save metadata files using metadata builder
      metadataBuilder.saveMetadataFiles(routeProfile, renderConfig, outputDir);

      renderState.progress = STAGES.PREPARATION.progressEnd;
      onProgress({
        stage: STAGES.PREPARATION.name,
        progress: STAGES.PREPARATION.progressEnd,
        message: 'Configuration prepared'
      });

      // Stage 3: Execute Docker render
      renderState.currentStage = STAGES.RENDERING.name;
      renderState.status = 'rendering';
      renderState.progress = STAGES.RENDERING.progressStart;
      onProgress({
        stage: STAGES.RENDERING.name,
        progress: STAGES.RENDERING.progressStart,
        message: 'Starting Docker container...'
      });

      const dockerResult = await dockerExecutor.executeDockerRender(
        renderConfig,
        renderState,
        onProgress,
        progressTracker.updateProgressFromDockerOutput
      );

      // Stage 4: Validate output
      renderState.currentStage = STAGES.VALIDATION.name;
      renderState.progress = STAGES.VALIDATION.progressStart;
      onProgress({
        stage: STAGES.VALIDATION.name,
        progress: STAGES.VALIDATION.progressStart,
        message: STAGES.VALIDATION.description
      });

      const validation = outputValidator.validateOutput(outputDir, dockerResult);

      if (!validation.success) {
        throw new Error(validation.error);
      }

      // Stage 5: Complete
      renderState.status = 'complete';
      renderState.progress = STAGES.COMPLETE.progressEnd;
      renderState.currentStage = STAGES.COMPLETE.name;

      const completionData = metadataBuilder.buildCompletionData(
        renderConfig,
        validation,
        dockerResult,
        startTime
      );

      metadataBuilder.logCompletion(renderId, startTime, validation.videoStats.size);

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
