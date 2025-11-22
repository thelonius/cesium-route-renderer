/**
 * Docker container configuration and helper functions
 */

const CONSTANTS = require('./constants.cjs');

class DockerConfig {
  constructor() {
    this.userId = CONSTANTS.DOCKER.USER_ID;
    this.groupId = CONSTANTS.DOCKER.GROUP_ID;
    this.shmSize = CONSTANTS.DOCKER.SHM_SIZE;
    this.imageName = CONSTANTS.DOCKER.DEFAULT_IMAGE;
    this.gpuDevice = CONSTANTS.DOCKER.GPU_DEVICE;
  }

  /**
   * Build Docker run arguments for a render job
   * @param {Object} options - Configuration options
   * @param {string} options.gpxPath - Absolute path to GPX file
   * @param {string} options.gpxFilename - GPX filename
   * @param {string} options.outputDir - Absolute path to output directory
   * @param {number} options.animationSpeed - Animation speed multiplier
   * @param {string} options.userName - User display name
   * @param {Object} options.recording - Recording settings (fps, width, height)
   * @returns {Array<string>} Docker run arguments
   */
  buildRunArgs(options) {
    const {
      gpxPath,
      gpxFilename,
      outputDir,
      animationSpeed,
      userName,
      recording = {}
    } = options;

    const args = [
      'run',
      '--rm',
      '--user', `${this.userId}:${this.groupId}`,
      '--shm-size', this.shmSize,
      '-v', `${gpxPath}:/app/dist/${gpxFilename}:ro`,
      '-v', `${outputDir}:/output`,
      '-e', `GPX_FILENAME=${gpxFilename}`,
      '-e', `ANIMATION_SPEED=${animationSpeed}`,
      '-e', `USER_NAME=${userName}`,
      '-e', `HEADLESS=1`,
      '-e', `RECORD_FPS=${recording.fps || CONSTANTS.RENDER.DEFAULT_FPS}`,
      '-e', `RECORD_WIDTH=${recording.width || CONSTANTS.RENDER.DEFAULT_WIDTH}`,
      '-e', `RECORD_HEIGHT=${recording.height || CONSTANTS.RENDER.DEFAULT_HEIGHT}`
    ];

    // Add RECORD_DURATION if provided (ensures full route is recorded)
    if (recording.durationSeconds) {
      args.push('-e', `RECORD_DURATION=${recording.durationSeconds}`);
    }

    return args;
  }

  /**
   * Check if GPU acceleration is available
   * @returns {boolean}
   */
  hasGPU() {
    const fs = require('fs');
    return fs.existsSync(this.gpuDevice);
  }

  /**
   * Add GPU device to Docker args if available
   * @param {Array<string>} args - Existing Docker arguments
   * @returns {Array<string>} Docker arguments with GPU if available
   */
  addGPUIfAvailable(args) {
    if (this.hasGPU()) {
      args.push('--device', this.gpuDevice);
      console.log('GPU device found, enabling hardware acceleration');
    }
    return args;
  }

  /**
   * Add image name to Docker args
   * @param {Array<string>} args - Existing Docker arguments
   * @returns {Array<string>} Docker arguments with image name
   */
  addImageName(args) {
    args.push(this.imageName);
    return args;
  }

  /**
   * Build complete Docker command arguments
   * @param {Object} options - Configuration options
   * @returns {Array<string>} Complete Docker run arguments
   */
  buildCompleteArgs(options) {
    let args = this.buildRunArgs(options);
    args = this.addGPUIfAvailable(args);
    args = this.addImageName(args);
    return args;
  }
}

module.exports = new DockerConfig();
