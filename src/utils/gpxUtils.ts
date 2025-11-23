import * as Cesium from 'cesium';

import { TrackPoint } from '../types';

export async function parseGPX(url: string): Promise<TrackPoint[]> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch GPX file: ${response.status} ${response.statusText}`);
  }

  const gpxText = await response.text();

  console.log(`Fetched GPX from ${url}, length: ${gpxText.length} bytes`);
  console.log('First 200 chars:', gpxText.substring(0, 200));

  // Check if the response is empty
  if (!gpxText || gpxText.trim().length === 0) {
    throw new Error(`GPX file at ${url} is empty`);
  }

  // Check if we got HTML instead of XML (common error when file not found)
  const trimmedText = gpxText.trim();
  if (trimmedText.startsWith('<!DOCTYPE html') ||
      trimmedText.startsWith('<!doctype html') ||
      trimmedText.startsWith('<html')) {
    console.error('Received HTML instead of GPX file');
    throw new Error(`GPX file not found: "${url}". Make sure the file exists in the public folder.`);
  }

  const parser = new DOMParser();
  const gpxDoc = parser.parseFromString(gpxText, 'text/xml');

  // Check for XML parsing errors
  const parseErrors = gpxDoc.getElementsByTagName('parsererror');
  if (parseErrors.length > 0) {
    console.error('XML parse error details:', parseErrors[0].textContent);
    console.error('Problematic XML:', gpxText.substring(0, 500));
    throw new Error('Failed to parse GPX XML - the file may be corrupted or invalid');
  }

  console.log('Root element:', gpxDoc.documentElement.nodeName); // Should be 'gpx'

  // Verify it's actually a GPX file (not KML or other format)
  const rootElement = gpxDoc.documentElement.nodeName.toLowerCase();
  if (rootElement !== 'gpx') {
    // If it's a KML file, suggest using parseKML instead
    if (rootElement === 'kml') {
      throw new Error(`This is a KML file, not GPX. Use parseKML() or ensure the URL ends with '.kml' for auto-detection.`);
    }
    throw new Error(`Invalid GPX file: root element is '${gpxDoc.documentElement.nodeName}', expected 'gpx'`);
  }

  const trackPoints: TrackPoint[] = [];

  // Try multiple methods to find track points (namespace-agnostic)
  // Method 1: Try with namespace
  let trkpts = gpxDoc.getElementsByTagNameNS('http://www.topografix.com/GPX/1/1', 'trkpt');

  // Method 2: Try without namespace (works for GPX 1.0 and files without namespace)
  if (trkpts.length === 0) {
    trkpts = gpxDoc.getElementsByTagName('trkpt');
  }

  // Method 3: Try with GPX 1.0 namespace
  if (trkpts.length === 0) {
    trkpts = gpxDoc.getElementsByTagNameNS('http://www.topografix.com/GPX/1/0', 'trkpt');
  }

  // Method 4: Try using querySelectorAll (works regardless of namespace)
  if (trkpts.length === 0) {
    const nodeList = gpxDoc.querySelectorAll('trkpt, trk trkpt');
    trkpts = nodeList as any;
  }

  console.log(`Found ${trkpts.length} track points in GPX file.`);

  if (trkpts.length === 0) {
    console.error('No track points found in GPX file');
    console.log('GPX structure:', gpxDoc.documentElement.outerHTML.substring(0, 500));
    throw new Error('No track points found in GPX file');
  }

  Array.from(trkpts).forEach((trkpt: Element) => {
    const lat = parseFloat(trkpt.getAttribute('lat') || '0');
    const lon = parseFloat(trkpt.getAttribute('lon') || '0');

    // Try to get elevation with and without namespace
    const eleElement = trkpt.querySelector('ele') ||
                      trkpt.getElementsByTagName('ele')[0] ||
                      trkpt.getElementsByTagNameNS('*', 'ele')[0];
    const ele = parseFloat(eleElement?.textContent || '0');

    // Try to get time with and without namespace
    const timeElement = trkpt.querySelector('time') ||
                       trkpt.getElementsByTagName('time')[0] ||
                       trkpt.getElementsByTagNameNS('*', 'time')[0];
    const time = timeElement?.textContent || '';

    trackPoints.push({ lat, lon, ele, time });
  });

  console.log(`Successfully parsed ${trackPoints.length} track points`);
  return trackPoints;
}

export function calculateElevationStats(trackPoints: TrackPoint[]): {
  totalGain: number;
  totalLoss: number;
  maxElevation: number;
  minElevation: number;
} {
  if (trackPoints.length < 2) {
    return { totalGain: 0, totalLoss: 0, maxElevation: 0, minElevation: 0 };
  }

  let totalGain = 0;
  let totalLoss = 0;
  let maxElevation = trackPoints[0].ele;
  let minElevation = trackPoints[0].ele;

  const ELEVATION_THRESHOLD = 3; // meters - ignore small changes to filter noise

  for (let i = 1; i < trackPoints.length; i++) {
    const elevDiff = trackPoints[i].ele - trackPoints[i - 1].ele;

    // Update min/max
    if (trackPoints[i].ele > maxElevation) maxElevation = trackPoints[i].ele;
    if (trackPoints[i].ele < minElevation) minElevation = trackPoints[i].ele;

    // Calculate gain/loss with threshold to ignore GPS noise
    if (Math.abs(elevDiff) >= ELEVATION_THRESHOLD) {
      if (elevDiff > 0) {
        totalGain += elevDiff;
      } else {
        totalLoss += Math.abs(elevDiff);
      }
    }
  }

  return {
    totalGain: Math.round(totalGain),
    totalLoss: Math.round(totalLoss),
    maxElevation: Math.round(maxElevation),
    minElevation: Math.round(minElevation)
  };
}

export function calculateTimestamps(trackPoints: TrackPoint[]): {
  startTime: Cesium.JulianDate;
  stopTime: Cesium.JulianDate;
  trackPointsWithTime: TrackPoint[];
} {
  const hasTimestamps = trackPoints[0]?.time && trackPoints[0].time !== '';

  if (hasTimestamps) {
    // Use original GPX timestamps - speed control is handled by animation multiplier
    const startTime = Cesium.JulianDate.fromIso8601(trackPoints[0].time);
    const stopTime = Cesium.JulianDate.fromIso8601(trackPoints[trackPoints.length - 1].time);
    return { startTime, stopTime, trackPointsWithTime: trackPoints };
  }

  // If no timestamps, create evenly distributed timestamps over 1 hour
  // Actual playback speed is controlled by animation multiplier
  const startTime = Cesium.JulianDate.now();
  const totalDurationSeconds = 3600; // 1 hour default
  const secondsPerPoint = totalDurationSeconds / (trackPoints.length - 1);

  const trackPointsWithTime = trackPoints.map((point, i) => {
    const pointTime = Cesium.JulianDate.addSeconds(startTime, i * secondsPerPoint, new Cesium.JulianDate());
    point.time = Cesium.JulianDate.toIso8601(pointTime);
    return point;
  });

  const stopTime = Cesium.JulianDate.fromIso8601(trackPointsWithTime[trackPointsWithTime.length - 1].time);
  return { startTime, stopTime, trackPointsWithTime };
}

// Validate track points for rendering readiness. Returns an object with
// errors (fatal) and warnings (non-fatal) to help callers decide whether
// to proceed or surface issues to users.
export function validateTrackPoints(trackPoints: TrackPoint[]) {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!trackPoints || trackPoints.length === 0) {
    errors.push('No track points found');
    return { errors, warnings };
  }

  if (trackPoints.length < 2) {
    errors.push('Too few track points — need at least 2');
    return { errors, warnings };
  }

  // Basic numeric checks
  for (let i = 0; i < trackPoints.length; i++) {
    const p = trackPoints[i];
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) {
      errors.push(`Invalid lat/lon at index ${i} (${p.lat}, ${p.lon})`);
      return { errors, warnings };
    }
    if (!Number.isFinite(p.ele)) {
      // Not fatal — set to 0 later if needed
      warnings.push(`Missing/invalid elevation at index ${i}, defaulting to 0`);
    }
  }

  // Time checks: if times exist, ensure monotonic increasing
  const hasAnyTime = trackPoints.some(p => p.time && p.time.trim() !== '');
  if (hasAnyTime) {
    let lastTs: number | null = null;
    for (let i = 0; i < trackPoints.length; i++) {
      const t = trackPoints[i].time;
      if (!t) {
        warnings.push(`Missing timestamp at index ${i} while other points have times`);
        continue;
      }
      let tsNum = null as number | null;
      try {
        tsNum = Cesium.JulianDate.toDate(Cesium.JulianDate.fromIso8601(t)).getTime();
      } catch (e) {
        errors.push(`Invalid timestamp format at index ${i}: ${t}`);
        return { errors, warnings };
      }
      if (lastTs !== null && tsNum !== null && tsNum <= lastTs) {
        errors.push(`Timestamps must be strictly increasing. Non-increasing at index ${i} (${t})`);
        return { errors, warnings };
      }
      lastTs = tsNum as number;
    }
  }

  // Distance/time density checks (sample a few points)
  const haversine = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371000; // m
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) * Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  };

  let totalDist = 0;
  for (let i = 1; i < trackPoints.length; i++) {
    const d = haversine(trackPoints[i-1].lat, trackPoints[i-1].lon, trackPoints[i].lat, trackPoints[i].lon);
    totalDist += d;
  }
  const avgSeg = totalDist / Math.max(1, trackPoints.length - 1);
  if (avgSeg > 20000) {
    warnings.push(`Average segment length is large (${(avgSeg/1000).toFixed(1)} km). Visual interpolation may look jumpy.`);
  }
  if (avgSeg < 0.5) {
    warnings.push(`Very dense track points (avg ${(avgSeg).toFixed(2)} m). Consider downsampling for performance.`);
  }

  // Time span checks
  const times = trackPoints.map(p => p.time).filter(Boolean) as string[];
  if (times.length > 1) {
    try {
      const jdTimes = times.map(t => Cesium.JulianDate.fromIso8601(t));
      const earliest = jdTimes[0];
      const latest = jdTimes[jdTimes.length - 1];
      const totalDuration = Cesium.JulianDate.secondsDifference(latest, earliest);
      if (totalDuration <= 0) {
        errors.push('Non-positive total duration calculated from timestamps');
        return { errors, warnings };
      }
      if (totalDuration > 3600 * 24 * 7) {
        warnings.push(`Very long route duration (${(totalDuration/3600).toFixed(1)} hours). Consider pre-compressing timestamps for faster rendering.`);
      }

      // Largest gap
      let largestGap = 0;
      for (let i = 1; i < jdTimes.length; i++) {
        const gap = Cesium.JulianDate.secondsDifference(jdTimes[i], jdTimes[i-1]);
        if (gap > largestGap) largestGap = gap;
      }
      if (largestGap > 3600) {
        warnings.push(`Large time gap detected between consecutive points (${(largestGap/3600).toFixed(1)} hours). This may produce long jumps.`);
      }
    } catch (e) {
      warnings.push('Could not compute time-span checks due to invalid timestamp parsing');
    }
  }

  // Missing timestamps ratio
  const missingCount = trackPoints.filter(p => !p.time || p.time.trim() === '').length;
  const missingPct = (missingCount / trackPoints.length) * 100;
  if (missingPct > 0 && missingPct < 100) {
    warnings.push(`Mixed timestamps: ${missingCount}/${trackPoints.length} points missing timestamps (${missingPct.toFixed(1)}%).`);
  }
  if (missingPct === 100) {
    warnings.push('No timestamps present — synthetic timestamps will be generated (1 hour default).');
  }

  // Duplicate coordinates check
  let dupCount = 0;
  for (let i = 1; i < trackPoints.length; i++) {
    const d = haversine(trackPoints[i-1].lat, trackPoints[i-1].lon, trackPoints[i].lat, trackPoints[i].lon);
    if (d < 0.1) dupCount++;
  }
  if (dupCount > Math.max(3, Math.floor(trackPoints.length * 0.05))) {
    warnings.push(`${dupCount} near-duplicate consecutive points detected. Consider pruning exact repeats.`);
  }

  // Point count / performance
  if (trackPoints.length > 5000) {
    warnings.push(`High point count (${trackPoints.length}) may impact rendering time; consider downsampling.`);
  }

  return { errors, warnings };
}