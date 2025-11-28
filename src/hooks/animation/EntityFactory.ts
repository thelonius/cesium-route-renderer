/**
 * EntityFactory - Creates Cesium entities for hiker and trail visualization
 * Extracted from useCesiumAnimation.ts
 */
import * as Cesium from 'cesium';

export interface HikerEntityOptions {
  positionProperty: Cesium.SampledPositionProperty;
  startTime: Cesium.JulianDate;
  stopTime: Cesium.JulianDate;
  userName?: string;
}

export interface TrailEntityOptions {
  getPositions: () => Cesium.Cartesian3[];
}

export interface FullRouteEntityOptions {
  positions: Cesium.Cartesian3[];
}

/**
 * Gets the display name for the hiker label
 * Includes easter egg for Mikael 🎉
 */
export function getHikerDisplayName(userName?: string): string {
  const name = userName || 'Hiker';
  // Easter egg for Mikael 🎉
  if (name.toLowerCase().includes('mikael') || name.toLowerCase().includes('ayrapetyan')) {
    return 'Микаэл, джан, дорогой!';
  }
  return name;
}

/**
 * Creates the hiker (moving point) entity with label
 */
export function createHikerEntity(
  viewer: Cesium.Viewer,
  options: HikerEntityOptions
): Cesium.Entity {
  const { positionProperty, startTime, stopTime, userName } = options;

  const hikerEntity = viewer.entities.add({
    availability: new Cesium.TimeIntervalCollection([
      new Cesium.TimeInterval({ start: startTime, stop: stopTime })
    ]),
    position: positionProperty,
    point: {
      pixelSize: 12,
      color: Cesium.Color.RED,
      outlineColor: Cesium.Color.WHITE,
      outlineWidth: 2,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      disableDepthTestDistance: Number.POSITIVE_INFINITY
    },
    label: {
      text: getHikerDisplayName(userName),
      font: '14pt sans-serif',
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      outlineWidth: 2,
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      pixelOffset: new Cesium.Cartesian2(0, -20),
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
    }
  });

  return hikerEntity;
}

/**
 * Creates the full route polyline (semi-transparent background route)
 */
export function createFullRouteEntity(
  viewer: Cesium.Viewer,
  options: FullRouteEntityOptions
): Cesium.Entity | null {
  const { positions } = options;

  if (positions.length <= 1) {
    return null;
  }

  const routeEntity = viewer.entities.add({
    polyline: {
      positions: positions,
      width: 3,
      material: new Cesium.PolylineOutlineMaterialProperty({
        color: Cesium.Color.WHITE.withAlpha(0.5),
        outlineWidth: 1,
        outlineColor: Cesium.Color.BLUE.withAlpha(0.3)
      }),
      clampToGround: true
    }
  });

  return routeEntity;
}

/**
 * Creates the dynamic trail (polyline following hiker)
 */
export function createTrailEntity(
  viewer: Cesium.Viewer,
  options: TrailEntityOptions
): Cesium.Entity {
  const { getPositions } = options;

  const trailEntity = viewer.entities.add({
    polyline: {
      positions: new Cesium.CallbackProperty(() => getPositions(), false),
      width: 4,
      material: new Cesium.ColorMaterialProperty(Cesium.Color.YELLOW.withAlpha(0.9)),
      depthFailMaterial: new Cesium.ColorMaterialProperty(Cesium.Color.YELLOW.withAlpha(0.5)),
      clampToGround: true,
      show: true
    }
  });

  return trailEntity;
}

/**
 * Removes entities from the viewer
 */
export function removeEntities(
  viewer: Cesium.Viewer,
  entities: { hiker: Cesium.Entity | null; trail: Cesium.Entity | null; route?: Cesium.Entity | null }
): void {
  if (entities.hiker) {
    try {
      viewer.entities.remove(entities.hiker);
    } catch (e) {
      console.warn('Failed to remove hiker entity:', e);
    }
  }
  if (entities.trail) {
    try {
      viewer.entities.remove(entities.trail);
    } catch (e) {
      console.warn('Failed to remove trail entity:', e);
    }
  }
  if (entities.route) {
    try {
      viewer.entities.remove(entities.route);
    } catch (e) {
      console.warn('Failed to remove route entity:', e);
    }
  }
}

/**
 * Configuration for initial camera positioning
 */
export interface InitialCameraConfig {
  baseBack: number;
  baseHeight: number;
}

/**
 * Sets initial camera position looking at the starting point
 */
export function setInitialCameraPosition(
  viewer: Cesium.Viewer,
  startPosition: Cesium.Cartesian3,
  config: InitialCameraConfig
): void {
  try {
    const startTransform = Cesium.Transforms.eastNorthUpToFixedFrame(startPosition);
    const initialCameraOffset = new Cesium.Cartesian3(
      -config.baseBack,
      0,
      config.baseHeight
    );
    const initialCameraPosition = Cesium.Matrix4.multiplyByPoint(
      startTransform,
      initialCameraOffset,
      new Cesium.Cartesian3()
    );

    viewer.camera.position = initialCameraPosition;
    viewer.camera.lookAt(
      startPosition,
      new Cesium.Cartesian3(0, 0, config.baseHeight)
    );
    viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
  } catch (e) {
    console.warn('Failed to set initial camera position:', e);
  }
}
