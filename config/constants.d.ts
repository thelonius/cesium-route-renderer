declare const constants: {
  DOCKER: Record<string, any>;
  MEMORY: Record<string, any>;
  RENDER: Record<string, any>;
  ANIMATION: {
    DEFAULT_SPEED: number;
    MIN_SPEED: number;
    MAX_SPEED: number;
    ADAPTIVE_BUFFER_MINUTES: number;
    INTRO_DURATION_SECONDS: number;
    OUTRO_DURATION_SECONDS: number;
    SETTLE_DURATION_SECONDS: number;
  };
  CAMERA: {
    BASE_BACK: number;
    BASE_HEIGHT: number;
    SMOOTH_ALPHA: number;
    TRAIL_ADD_INTERVAL_SECONDS: number;
  };
  TELEGRAM: Record<string, any>;
  GEO: Record<string, any>;
  CLEANUP: Record<string, any>;
  API: Record<string, any>;
};

export default constants;
