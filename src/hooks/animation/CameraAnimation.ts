import * as Cesium from 'cesium';

export class CameraAnimation {
  private viewer: Cesium.Viewer;
  private durationSeconds: number;
  private onTick: (progress: number) => void;
  private onComplete?: () => void;
  private startTime = 0;
  private rafId: number | null = null;

  constructor(
    viewer: Cesium.Viewer,
    durationSeconds: number,
    onTick: (progress: number) => void,
    onComplete?: () => void
  ) {
    this.viewer = viewer;
    this.durationSeconds = Math.max(0.001, durationSeconds);
    this.onTick = onTick;
    this.onComplete = onComplete;
  }

  start() {
    this.cancel();
    this.startTime = performance.now();
    const step = () => {
      const now = performance.now();
      const elapsed = (now - this.startTime) / 1000;
      const progress = Math.min(1, Math.max(0, elapsed / this.durationSeconds));
      try {
        this.onTick(progress);
      } catch {}
      if (progress < 1) {
        this.rafId = requestAnimationFrame(step);
      } else {
        this.rafId = null;
        try { this.onComplete && this.onComplete(); } catch {}
      }
    };
    this.rafId = requestAnimationFrame(step);
  }

  cancel() {
    if (this.rafId != null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }
}
