/**
 * Pipeline Stages
 *
 * Defines the 5 stages of the render pipeline and their transitions
 */

const STAGES = {
  ROUTE_ANALYSIS: {
    name: 'route-analysis',
    progressStart: 10,
    progressEnd: 20,
    description: 'Analyzing route geometry and patterns'
  },
  PREPARATION: {
    name: 'preparation',
    progressStart: 20,
    progressEnd: 30,
    description: 'Preparing render configuration'
  },
  RENDERING: {
    name: 'rendering',
    progressStart: 30,
    progressEnd: 90,
    description: 'Executing Docker render'
  },
  VALIDATION: {
    name: 'validation',
    progressStart: 90,
    progressEnd: 95,
    description: 'Validating output'
  },
  COMPLETE: {
    name: 'complete',
    progressStart: 95,
    progressEnd: 100,
    description: 'Render complete'
  }
};

const STAGE_ORDER = [
  STAGES.ROUTE_ANALYSIS,
  STAGES.PREPARATION,
  STAGES.RENDERING,
  STAGES.VALIDATION,
  STAGES.COMPLETE
];

/**
 * Get stage by name
 */
function getStage(stageName) {
  return Object.values(STAGES).find(stage => stage.name === stageName);
}

/**
 * Get next stage in pipeline
 */
function getNextStage(currentStageName) {
  const currentIndex = STAGE_ORDER.findIndex(stage => stage.name === currentStageName);
  if (currentIndex === -1 || currentIndex === STAGE_ORDER.length - 1) {
    return null;
  }
  return STAGE_ORDER[currentIndex + 1];
}

/**
 * Check if stage is terminal (last stage)
 */
function isTerminalStage(stageName) {
  return stageName === STAGES.COMPLETE.name;
}

module.exports = {
  STAGES,
  STAGE_ORDER,
  getStage,
  getNextStage,
  isTerminalStage
};
