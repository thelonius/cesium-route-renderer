// Runtime camera constants overrides helper

const cameraOverrides: Partial<Record<string, number>> = {};

export function setCameraConstants(overrides: Partial<Record<string, number>>) {
  Object.assign(cameraOverrides, overrides);
  try {
    if ((window as any).__ENABLE_DIAGNOSTICS) {
      console.log('Camera constants overridden:', JSON.stringify(overrides));
    }
  } catch (e) {}
}

export function getCameraValue(key: string, defaultValue: number) {
  if (cameraOverrides && Object.prototype.hasOwnProperty.call(cameraOverrides, key)) {
    const v = cameraOverrides[key as keyof typeof cameraOverrides];
    if (typeof v === 'number') return v;
  }
  return defaultValue;
}

// Expose globally for runtime tweaks
try {
  (window as any).setCameraConstants = setCameraConstants;
} catch (e) {}

export default {
  setCameraConstants,
  getCameraValue
};
