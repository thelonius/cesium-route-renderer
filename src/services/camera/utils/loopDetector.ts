import * as Cesium from 'cesium';

/**
 * Loop/Circular Route Detection
 *
 * Detects if a route circles around a focal point (mountain, landmark, etc.)
 * and calculates the best camera positioning for "outside looking in" view.
 */

export interface LoopAnalysis {
  isLoop: boolean;
  loopness: number; // 0-1, how circular/loop-like the route is
  centroid: Cesium.Cartesian3 | null; // focal point the route circles around
  averageRadius: number; // average distance from centroid to route points
  cameraOffset: Cesium.Cartesian3 | null; // suggested camera position offset from centroid
  recommendedHeight: number; // suggested camera height
}

/**
 * Analyze if route forms a loop/circle around a focal point
 */
export function detectLoop(positions: Cesium.Cartesian3[]): LoopAnalysis {
  if (positions.length < 10) {
    return {
      isLoop: false,
      loopness: 0,
      centroid: null,
      averageRadius: 0,
      cameraOffset: null,
      recommendedHeight: 0
    };
  }

  // Calculate geometric centroid
  const centroid = calculateCentroid(positions);

  // Calculate distances from centroid to each point
  const distances = positions.map(pos => Cesium.Cartesian3.distance(centroid, pos));
  const averageRadius = distances.reduce((sum, d) => sum + d, 0) / distances.length;
  const stdDev = Math.sqrt(
    distances.reduce((sum, d) => sum + Math.pow(d - averageRadius, 2), 0) / distances.length
  );

  // Calculate variation coefficient (lower = more circular)
  const variationCoefficient = stdDev / averageRadius;

  // Calculate angular coverage (how much of the circle is covered)
  const angularCoverage = calculateAngularCoverage(positions, centroid);

  // Calculate direction changes (loops tend to have consistent turn direction)
  const turnConsistency = calculateTurnConsistency(positions);

  // Calculate loopness score (0-1)
  // - Low variation coefficient = more circular
  // - High angular coverage = covers more of the circle
  // - High turn consistency = consistent turning direction
  const loopness = Math.min(1, (
    (1 - Math.min(variationCoefficient, 1)) * 0.4 +
    (angularCoverage / 360) * 0.4 +
    turnConsistency * 0.2
  ));

  const isLoop = loopness > 0.5; // Threshold for considering it a loop

  // Calculate optimal camera offset (perpendicular to average route direction)
  const cameraOffset = isLoop
    ? calculateOptimalCameraOffset(positions, centroid, averageRadius)
    : null;

  // Recommended height based on loop size
  const recommendedHeight = averageRadius * 1.5;

  return {
    isLoop,
    loopness,
    centroid: isLoop ? centroid : null,
    averageRadius,
    cameraOffset,
    recommendedHeight
  };
}

/**
 * Calculate geometric centroid of positions
 */
function calculateCentroid(positions: Cesium.Cartesian3[]): Cesium.Cartesian3 {
  const sum = positions.reduce(
    (acc, pos) => Cesium.Cartesian3.add(acc, pos, new Cesium.Cartesian3()),
    new Cesium.Cartesian3(0, 0, 0)
  );
  return Cesium.Cartesian3.divideByScalar(sum, positions.length, new Cesium.Cartesian3());
}

/**
 * Calculate how many degrees of the circle are covered by route points
 */
function calculateAngularCoverage(
  positions: Cesium.Cartesian3[],
  centroid: Cesium.Cartesian3
): number {
  // Convert to angles around centroid
  const angles = positions.map(pos => {
    const vector = Cesium.Cartesian3.subtract(pos, centroid, new Cesium.Cartesian3());
    return Math.atan2(vector.y, vector.x) * (180 / Math.PI);
  });

  // Sort angles
  const sortedAngles = angles.sort((a, b) => a - b);

  // Find largest gap
  let maxGap = 0;
  for (let i = 0; i < sortedAngles.length - 1; i++) {
    const gap = sortedAngles[i + 1] - sortedAngles[i];
    maxGap = Math.max(maxGap, gap);
  }
  // Check wrap-around gap
  const wrapGap = 360 - (sortedAngles[sortedAngles.length - 1] - sortedAngles[0]);
  maxGap = Math.max(maxGap, wrapGap);

  // Coverage = 360 - largest gap
  return 360 - maxGap;
}

/**
 * Calculate consistency of turning direction (left vs right)
 * Returns 0-1, where 1 = all turns in same direction
 */
function calculateTurnConsistency(positions: Cesium.Cartesian3[]): number {
  if (positions.length < 3) return 0;

  let leftTurns = 0;
  let rightTurns = 0;

  for (let i = 1; i < positions.length - 1; i++) {
    const v1 = Cesium.Cartesian3.subtract(
      positions[i],
      positions[i - 1],
      new Cesium.Cartesian3()
    );
    const v2 = Cesium.Cartesian3.subtract(
      positions[i + 1],
      positions[i],
      new Cesium.Cartesian3()
    );

    const cross = Cesium.Cartesian3.cross(v1, v2, new Cesium.Cartesian3());
    const crossMagnitude = Cesium.Cartesian3.magnitude(cross);

    if (crossMagnitude > 0.001) {
      // Determine if left or right turn based on cross product sign
      if (cross.z > 0) {
        leftTurns++;
      } else {
        rightTurns++;
      }
    }
  }

  const totalTurns = leftTurns + rightTurns;
  if (totalTurns === 0) return 0;

  // Consistency = how much one direction dominates
  const dominantTurns = Math.max(leftTurns, rightTurns);
  return dominantTurns / totalTurns;
}

/**
 * Calculate optimal camera offset position outside the loop
 * Camera should be positioned to see both the loop and the focal point
 */
function calculateOptimalCameraOffset(
  positions: Cesium.Cartesian3[],
  centroid: Cesium.Cartesian3,
  averageRadius: number
): Cesium.Cartesian3 {
  // Find the point on the route furthest from centroid
  let maxDistance = 0;
  let furthestPoint = positions[0];

  positions.forEach(pos => {
    const distance = Cesium.Cartesian3.distance(centroid, pos);
    if (distance > maxDistance) {
      maxDistance = distance;
      furthestPoint = pos;
    }
  });

  // Camera offset is in direction of furthest point, but further out
  const direction = Cesium.Cartesian3.subtract(
    furthestPoint,
    centroid,
    new Cesium.Cartesian3()
  );
  Cesium.Cartesian3.normalize(direction, direction);

  // Position camera 1.5x the average radius away from centroid
  const offsetDistance = averageRadius * 1.5;
  return Cesium.Cartesian3.multiplyByScalar(
    direction,
    offsetDistance,
    new Cesium.Cartesian3()
  );
}

/**
 * Get smoothed camera position that filters out small movements (lazy camera)
 *
 * @param currentTarget - Current hiker/entity position
 * @param previousSmoothed - Previously smoothed camera target
 * @param movementThreshold - Minimum movement to trigger update (meters)
 * @param smoothingFactor - 0-1, higher = more smoothing
 */
export function getLazyCameraTarget(
  currentTarget: Cesium.Cartesian3,
  previousSmoothed: Cesium.Cartesian3 | null,
  movementThreshold: number = 50, // meters
  smoothingFactor: number = 0.85
): Cesium.Cartesian3 {
  if (!previousSmoothed) {
    return currentTarget.clone();
  }

  const distance = Cesium.Cartesian3.distance(currentTarget, previousSmoothed);

  // If movement is below threshold, don't update (lazy)
  if (distance < movementThreshold) {
    return previousSmoothed.clone();
  }

  // Smoothly interpolate toward new target
  return Cesium.Cartesian3.lerp(
    previousSmoothed,
    currentTarget,
    1 - smoothingFactor,
    new Cesium.Cartesian3()
  );
}
