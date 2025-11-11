const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.join(__dirname, '../output');
const LOGS_DIR = path.join(__dirname, '../logs');

// Keep renders from the last 24 hours (1 day)
const RETENTION_MS = 24 * 60 * 60 * 1000;

function cleanupOldRenders() {
  console.log('🧹 Starting cleanup of old renders...');

  const now = Date.now();
  let deletedCount = 0;
  let freedSpace = 0;

  // Cleanup output directory
  if (fs.existsSync(OUTPUT_DIR)) {
    const renders = fs.readdirSync(OUTPUT_DIR);

    for (const renderDir of renders) {
      if (!renderDir.startsWith('render-')) continue;

      const renderPath = path.join(OUTPUT_DIR, renderDir);
      const stats = fs.statSync(renderPath);

      // Check if older than retention period
      if (now - stats.mtimeMs > RETENTION_MS) {
        try {
          // Calculate size before deletion
          const size = getFolderSize(renderPath);

          // Delete the directory recursively
          fs.rmSync(renderPath, { recursive: true, force: true });

          deletedCount++;
          freedSpace += size;
          console.log(`  ✓ Deleted: ${renderDir} (${(size / 1024 / 1024).toFixed(2)} MB)`);
        } catch (error) {
          console.error(`  ✗ Failed to delete ${renderDir}:`, error.message);
        }
      }
    }
  }

  // Cleanup logs directory
  if (fs.existsSync(LOGS_DIR)) {
    const logs = fs.readdirSync(LOGS_DIR);

    for (const logDir of logs) {
      if (!logDir.startsWith('render-')) continue;

      const logPath = path.join(LOGS_DIR, logDir);
      const stats = fs.statSync(logPath);

      // Check if older than retention period
      if (now - stats.mtimeMs > RETENTION_MS) {
        try {
          const size = getFolderSize(logPath);
          fs.rmSync(logPath, { recursive: true, force: true });
          freedSpace += size;
          console.log(`  ✓ Deleted log: ${logDir}`);
        } catch (error) {
          console.error(`  ✗ Failed to delete log ${logDir}:`, error.message);
        }
      }
    }
  }

  console.log(`✅ Cleanup complete: Deleted ${deletedCount} renders, freed ${(freedSpace / 1024 / 1024).toFixed(2)} MB`);
}

function getFolderSize(folderPath) {
  let size = 0;

  try {
    const files = fs.readdirSync(folderPath);

    for (const file of files) {
      const filePath = path.join(folderPath, file);
      const stats = fs.statSync(filePath);

      if (stats.isDirectory()) {
        size += getFolderSize(filePath);
      } else {
        size += stats.size;
      }
    }
  } catch (error) {
    // Ignore errors
  }

  return size;
}

// Run cleanup
cleanupOldRenders();

// Schedule periodic cleanup every 6 hours
setInterval(() => {
  cleanupOldRenders();
}, 6 * 60 * 60 * 1000);

console.log('🕒 Cleanup scheduled to run every 6 hours');
