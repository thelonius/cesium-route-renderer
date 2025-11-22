import * as Cesium from 'cesium';

/**
 * Camera Math Utilities
 * Geometric calculations for camera positioning and orientation
 */

/**
 * Calculate heading (direction) from one position to another
 */
export function calculateHeading(from: Cesium.Cartesian3, to: Cesium.Cartesian3): number {
  const fromCartographic = Cesium.Cartographic.fromCartesian(from);
  const toCartographic = Cesium.Cartographic.fromCartesian(to);

  const longitudeDiff = toCartographic.longitude - fromCartographic.longitude;
  const latitudeDiff = toCartographic.latitude - fromCartographic.latitude;

  return Math.atan2(longitudeDiff, latitudeDiff);
}

/**
 * Calculate camera position behind and above entity
 */
export function calculateCameraPosition(
  entityPosition: Cesium.Cartesian3,
  heading: number,
  distance: number,
  height: number
): Cesium.Cartesian3 {
  const cartographic = Cesium.Cartographic.fromCartesian(entityPosition);

  // Move backwards (opposite of heading)
  const backwardHeading = heading + Math.PI;

  // Calculate offset
  const earthRadius = 6378137; // meters
  const deltaLat = (distance * Math.cos(backwardHeading)) / earthRadius;
  const deltaLon =
    (distance * Math.sin(backwardHeading)) / (earthRadius * Math.cos(cartographic.latitude));

  const cameraCartographic = new Cesium.Cartographic(
    cartographic.longitude + deltaLon,
    cartographic.latitude + deltaLat,
    cartographic.height + height
  );

  return Cesium.Cartographic.toCartesian(cameraCartographic);
}

/**
 * Calculate look-at position ahead of entity
 */
export function calculateLookAtPosition(
  entityPosition: Cesium.Cartesian3,
  heading: number,
  distance: number
): Cesium.Cartesian3 {
  const cartographic = Cesium.Cartographic.fromCartesian(entityPosition);

  const earthRadius = 6378137;
  const deltaLat = (distance * Math.cos(heading)) / earthRadius;
  const deltaLon = (distance * Math.sin(heading)) / (earthRadius * Math.cos(cartographic.latitude));

  const lookAtCartographic = new Cesium.Cartographic(
    cartographic.longitude + deltaLon,
    cartographic.latitude + deltaLat,
    cartographic.height
  );

  return Cesium.Cartographic.toCartesian(lookAtCartographic);
}

/**
 * Calculate camera orientation (HPR) to look at target
 */
export function calculateOrientation(
  cameraPosition: Cesium.Cartesian3,
  targetPosition: Cesium.Cartesian3
): { heading: number; pitch: number; roll: number } {
  const direction = Cesium.Cartesian3.subtract(
    targetPosition,
    cameraPosition,
    new Cesium.Cartesian3()
  );
  Cesium.Cartesian3.normalize(direction, direction);

  const up = Cesium.Cartesian3.normalize(cameraPosition, new Cesium.Cartesian3());

  // Calculate heading
  const east = Cesium.Cartesian3.cross(Cesium.Cartesian3.UNIT_Z, up, new Cesium.Cartesian3());
  Cesium.Cartesian3.normalize(east, east);

  const north = Cesium.Cartesian3.cross(up, east, new Cesium.Cartesian3());
  Cesium.Cartesian3.normalize(north, north);

  const heading = Math.atan2(
    Cesium.Cartesian3.dot(direction, east),
    Cesium.Cartesian3.dot(direction, north)
  );

  // Calculate pitch
  const pitch = Math.asin(Cesium.Cartesian3.dot(direction, up)) - Cesium.Math.PI_OVER_TWO;

  return { heading, pitch, roll: 0 };
}

/**
 * Calculate center of positions
 */
export function calculateCenter(positions: Cesium.Cartesian3[]): Cesium.Cartesian3 {
  const sum = positions.reduce(
    (acc, pos) => Cesium.Cartesian3.add(acc, pos, new Cesium.Cartesian3()),
    new Cesium.Cartesian3(0, 0, 0)
  );

  return Cesium.Cartesian3.divideByScalar(sum, positions.length, new Cesium.Cartesian3());
}

/**
 * Calculate bounding box of positions
 */
export function calculateBounds(
  positions: Cesium.Cartesian3[]
): { width: number; height: number; depth: number } {
  const cartographics = positions.map((pos) => Cesium.Cartographic.fromCartesian(pos));

  const lons = cartographics.map((c) => c.longitude);
  const lats = cartographics.map((c) => c.latitude);
  const heights = cartographics.map((c) => c.height);

  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minHeight = Math.min(...heights);
  const maxHeight = Math.max(...heights);

  const earthRadius = 6378137;
  const width = (maxLon - minLon) * earthRadius * Math.cos((minLat + maxLat) / 2);
  const height = (maxLat - minLat) * earthRadius;
  const depth = maxHeight - minHeight;

  return { width, height, depth };
}

/**
 * Interpolate between two angles, taking shortest path
 */
export function lerpAngle(angle1: number, angle2: number, t: number): number {
  // Normalize angles to [-π, π]
  const normalize = (angle: number) => {
    while (angle > Math.PI) angle -= 2 * Math.PI;
    while (angle < -Math.PI) angle += 2 * Math.PI;
    return angle;
  };

  angle1 = normalize(angle1);
  angle2 = normalize(angle2);

  // Find shortest path
  let diff = angle2 - angle1;
  if (diff > Math.PI) diff -= 2 * Math.PI;
  if (diff < -Math.PI) diff += 2 * Math.PI;

  return angle1 + diff * t;
}

/**
 * Apply smoothing curve to interpolation parameter
 */
export function applySmoothingCurve(t: number, smoothingFactor: number): number {
  // Ease-in-out cubic
  if (smoothingFactor > 0.8) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  // Ease-in-out quadratic
  if (smoothingFactor > 0.6) {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }

  // Linear
  return t;
}
