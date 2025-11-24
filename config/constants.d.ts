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
    OFFSET_LOOKAT_X_RATIO: number;
    OFFSET_LOOKAT_Z_RATIO: number;
    AZIMUTH_MULTIPLIER: number;
    TRAIL_ADD_INTERVAL_SECONDS: number;
    TILT_DEGREES: number;
  };
  TELEGRAM: Record<string, any>;
  GEO: Record<string, any>;
  CLEANUP: Record<string, any>;
  API: Record<string, any>;
};

export default constants;
