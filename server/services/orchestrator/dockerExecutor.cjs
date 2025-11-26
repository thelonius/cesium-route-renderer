const path = require('path');
const dockerService = require('../dockerService');

/**
 * Docker Executor
 *
 * Handles Docker container execution and monitoring
 */

/**
 * Execute Docker render with progress tracking
 */
function executeDockerRender(renderConfig, renderState, onProgress, onProgressUpdate) {
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
          // Track progress from Docker output
          if (onProgressUpdate) {
            onProgressUpdate(text, renderState, onProgress);
          }
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
            // Log stderr to help diagnose Docker failures
            if (stderr) {
              console.error('Docker stderr output:', stderr);
            }
            const error = new Error(`Docker exited with code ${code}`);
            error.stderr = stderr;
            error.stdout = stdout;
            reject(error);
          } else {
            resolve(dockerOutputs);
          }
        }
      }
    );

    renderState.dockerContainer = containerInfo;
  });
}

module.exports = {
  executeDockerRender
};
