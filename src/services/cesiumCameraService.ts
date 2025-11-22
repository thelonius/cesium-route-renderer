/**
 * Cesium Camera Service (Legacy Wrapper)
 *
 * This file now re-exports from the refactored modular structure.
 * The service has been split into focused modules:
 * - camera/strategies/ - Strategy implementations
 * - camera/utils/ - Math and utility functions
 * - camera/types.ts - Type definitions
 * - camera/patternAdjustments.ts - Pattern configuration
 *
 * Import from './camera' for the new structure, or continue using
 * this file for backward compatibility.
 */

export * from './camera';
export { default } from './camera';
