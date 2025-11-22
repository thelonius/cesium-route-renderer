/**
 * Progress Tracker
 *
 * Parses Docker output and updates render progress
 */

/**
 * Update progress based on Docker output
 * Looks for frame indicators and maps to overall progress
 */
function updateProgressFromDockerOutput(text, renderState, onProgress) {
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

module.exports = {
  updateProgressFromDockerOutput
};
