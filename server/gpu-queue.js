const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * GPU Container Queue Manager
 * 
 * Manages a queue of Docker container render jobs to prevent GPU overload.
 * Features:
 * - Configurable concurrency (default: 1 for single GPU)
 * - Job queue with priority support
 * - Real-time progress tracking
 * - Automatic cleanup on completion/failure
 */

class GPUQueue {
  constructor(options = {}) {
    this.maxConcurrent = options.maxConcurrent || 1; // How many containers can run simultaneously
    this.running = new Map(); // Currently running jobs: Map<jobId, jobInfo>
    this.queue = []; // Waiting jobs: Array<jobInfo>
    this.completed = new Map(); // Completed jobs: Map<jobId, result>
    this.failed = new Map(); // Failed jobs: Map<jobId, error>
  }

  /**
   * Add a render job to the queue
   * @param {Object} job - Job configuration
   * @param {string} job.id - Unique job identifier
   * @param {Object} job.docker - Docker configuration
   * @param {Array} job.docker.args - Docker arguments array
   * @param {string} job.outputDir - Output directory path
   * @param {string} job.logPath - Log file path
   * @param {Function} job.onProgress - Optional progress callback
   * @param {Function} job.onComplete - Completion callback
   * @param {number} job.priority - Optional priority (higher = sooner, default: 0)
   * @returns {Object} Job status
   */
  addJob(job) {
    if (!job.id || !job.docker || !job.outputDir || !job.logPath) {
      throw new Error('Invalid job configuration');
    }

    // Check if job already exists
    if (this.running.has(job.id) || this.queue.find(j => j.id === job.id)) {
      return {
        status: 'duplicate',
        message: 'Job already in queue or running',
        position: this._getJobPosition(job.id)
      };
    }

    const jobInfo = {
      ...job,
      priority: job.priority || 0,
      addedAt: Date.now(),
      status: 'queued'
    };

    // Add to queue
    this.queue.push(jobInfo);
    
    // Sort by priority (higher first), then by addedAt (older first)
    this.queue.sort((a, b) => {
      if (b.priority !== a.priority) {
        return b.priority - a.priority;
      }
      return a.addedAt - b.addedAt;
    });

    const position = this._getJobPosition(job.id);

    console.log(`📋 Job ${job.id} added to queue (position: ${position}, priority: ${jobInfo.priority})`);
    this._logToFile(job.logPath, `[${new Date().toISOString()}] ⏳ Added to render queue (position: ${position}/${this.queue.length})`);

    // Try to start the job immediately if capacity available
    this._processQueue();

    return {
      status: 'queued',
      position,
      queueLength: this.queue.length,
      running: this.running.size,
      estimatedWaitTime: this._estimateWaitTime(position)
    };
  }

  /**
   * Get status of a specific job
   */
  getJobStatus(jobId) {
    if (this.running.has(jobId)) {
      const job = this.running.get(jobId);
      return {
        status: 'running',
        startedAt: job.startedAt,
        runningTime: Date.now() - job.startedAt
      };
    }

    const queuedJob = this.queue.find(j => j.id === jobId);
    if (queuedJob) {
      const position = this._getJobPosition(jobId);
      return {
        status: 'queued',
        position,
        queueLength: this.queue.length,
        estimatedWaitTime: this._estimateWaitTime(position)
      };
    }

    if (this.completed.has(jobId)) {
      return {
        status: 'completed',
        result: this.completed.get(jobId)
      };
    }

    if (this.failed.has(jobId)) {
      return {
        status: 'failed',
        error: this.failed.get(jobId)
      };
    }

    return {
      status: 'not_found'
    };
  }

  /**
   * Get overall queue statistics
   */
  getStats() {
    return {
      maxConcurrent: this.maxConcurrent,
      running: this.running.size,
      queued: this.queue.length,
      completed: this.completed.size,
      failed: this.failed.size,
      runningJobs: Array.from(this.running.keys()),
      queuedJobs: this.queue.map(j => ({
        id: j.id,
        priority: j.priority,
        addedAt: j.addedAt,
        waitingTime: Date.now() - j.addedAt
      }))
    };
  }

  /**
   * Cancel a queued job
   */
  cancelJob(jobId) {
    const index = this.queue.findIndex(j => j.id === jobId);
    if (index !== -1) {
      const job = this.queue[index];
      this.queue.splice(index, 1);
      this._logToFile(job.logPath, `[${new Date().toISOString()}] ❌ Job cancelled by user`);
      console.log(`❌ Job ${jobId} cancelled`);
      return { success: true, message: 'Job cancelled' };
    }

    if (this.running.has(jobId)) {
      const job = this.running.get(jobId);
      if (job.process) {
        job.process.kill('SIGTERM');
        this._logToFile(job.logPath, `[${new Date().toISOString()}] ❌ Job terminated by user`);
        console.log(`❌ Job ${jobId} terminated`);
        return { success: true, message: 'Job terminated' };
      }
    }

    return { success: false, message: 'Job not found or already completed' };
  }

  // ============ Private Methods ============

  _getJobPosition(jobId) {
    return this.queue.findIndex(j => j.id === jobId) + 1;
  }

  _estimateWaitTime(position) {
    if (position <= 0) return 0;
    
    // Estimate based on average render time (assume 10 minutes per job)
    const avgRenderMinutes = 10;
    const jobsAhead = position - 1;
    const slotsAvailable = this.maxConcurrent - this.running.size;
    
    if (slotsAvailable > 0) {
      // Can start immediately or soon
      return Math.ceil((jobsAhead / this.maxConcurrent) * avgRenderMinutes * 60);
    } else {
      // All slots full, wait for current jobs + queued jobs
      return Math.ceil((jobsAhead / this.maxConcurrent) * avgRenderMinutes * 60);
    }
  }

  _processQueue() {
    // Start jobs up to max concurrent limit
    while (this.running.size < this.maxConcurrent && this.queue.length > 0) {
      const job = this.queue.shift();
      this._startJob(job);
    }
  }

  _startJob(job) {
    console.log(`🚀 Starting job ${job.id} (running: ${this.running.size + 1}/${this.maxConcurrent})`);
    
    job.status = 'running';
    job.startedAt = Date.now();
    this.running.set(job.id, job);

    this._logToFile(job.logPath, `[${new Date().toISOString()}] 🚀 Render started (GPU slot ${this.running.size}/${this.maxConcurrent})`);

    // Start Docker process
    const dockerProcess = spawn('docker', job.docker.args);
    job.process = dockerProcess;

    let stdoutBuffer = '';
    let stderrBuffer = '';

    // Stream stdout to log file
    dockerProcess.stdout.on('data', (data) => {
      const text = data.toString();
      stdoutBuffer += text;
      fs.appendFileSync(job.logPath, text);
      
      if (job.onProgress) {
        job.onProgress({ type: 'stdout', data: text });
      }
    });

    // Stream stderr to log file
    dockerProcess.stderr.on('data', (data) => {
      const text = data.toString();
      stderrBuffer += text;
      fs.appendFileSync(job.logPath, text);
      
      if (job.onProgress) {
        job.onProgress({ type: 'stderr', data: text });
      }
    });

    dockerProcess.on('error', (error) => {
      console.error(`❌ Job ${job.id} spawn error:`, error);
      this._logToFile(job.logPath, `[${new Date().toISOString()}] ❌ Docker spawn error: ${error.message}\n`);
      
      this._jobFailed(job, {
        error: 'Failed to start Docker container',
        details: error.message,
        stdout: stdoutBuffer,
        stderr: stderrBuffer
      });
    });

    dockerProcess.on('close', (code) => {
      const duration = ((Date.now() - job.startedAt) / 1000).toFixed(1);
      
      if (code === 0) {
        console.log(`✅ Job ${job.id} completed successfully (${duration}s)`);
        this._logToFile(job.logPath, `[${new Date().toISOString()}] ✅ Render completed successfully (duration: ${duration}s)\n`);
        
        this._jobCompleted(job, {
          success: true,
          duration: duration,
          stdout: stdoutBuffer,
          stderr: stderrBuffer
        });
      } else {
        console.error(`❌ Job ${job.id} failed with code ${code} (${duration}s)`);
        this._logToFile(job.logPath, `[${new Date().toISOString()}] ❌ Docker exited with code ${code}\n`);
        
        this._jobFailed(job, {
          error: 'Failed to render video',
          details: `Docker exited with code ${code}`,
          exitCode: code,
          duration: duration,
          stdout: stdoutBuffer,
          stderr: stderrBuffer
        });
      }
    });
  }

  _jobCompleted(job, result) {
    this.running.delete(job.id);
    this.completed.set(job.id, { ...result, completedAt: Date.now() });
    
    if (job.onComplete) {
      job.onComplete(null, result);
    }

    // Clean up old completed jobs (keep last 100)
    if (this.completed.size > 100) {
      const oldestKey = this.completed.keys().next().value;
      this.completed.delete(oldestKey);
    }

    // Process next job in queue
    this._processQueue();
  }

  _jobFailed(job, error) {
    this.running.delete(job.id);
    this.failed.set(job.id, { ...error, failedAt: Date.now() });
    
    if (job.onComplete) {
      job.onComplete(error, null);
    }

    // Clean up old failed jobs (keep last 100)
    if (this.failed.size > 100) {
      const oldestKey = this.failed.keys().next().value;
      this.failed.delete(oldestKey);
    }

    // Process next job in queue
    this._processQueue();
  }

  _logToFile(logPath, message) {
    try {
      fs.appendFileSync(logPath, message);
    } catch (error) {
      console.error('Failed to write to log file:', error);
    }
  }
}

// Singleton instance
let queueInstance = null;

module.exports = {
  /**
   * Initialize or get the GPU queue instance
   * @param {Object} options - Configuration options
   * @param {number} options.maxConcurrent - Max concurrent GPU containers (default: 1)
   */
  getQueue: (options) => {
    if (!queueInstance) {
      queueInstance = new GPUQueue(options);
      console.log(`🎬 GPU Queue initialized (max concurrent: ${queueInstance.maxConcurrent})`);
    }
    return queueInstance;
  },

  GPUQueue // Export class for testing
};
