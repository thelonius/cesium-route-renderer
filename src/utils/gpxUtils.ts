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

export function calculateTimestamps(trackPoints: TrackPoint[], normalizeSpeed: boolean = true): {
  startTime: Cesium.JulianDate;
  stopTime: Cesium.JulianDate;
  trackPointsWithTime: TrackPoint[];
} {
  let startTime: Cesium.JulianDate;
  let stopTime: Cesium.JulianDate;
  const hasTimestamps = trackPoints[0]?.time && trackPoints[0].time !== '';

  // Always normalize speed for smoother animation by default (normalizeSpeed=true)
  // This prevents jerky movement from speed variations during actual recording
  // (e.g., running downhill fast, walking uphill slow, stopping for breaks)
  if (hasTimestamps && !normalizeSpeed) {
    startTime = Cesium.JulianDate.fromIso8601(trackPoints[0].time);
    stopTime = Cesium.JulianDate.fromIso8601(trackPoints[trackPoints.length - 1].time);
    return { startTime, stopTime, trackPointsWithTime: trackPoints };
  }

  // Recalculate timestamps with constant speed for smooth, consistent animation
  const WALKING_SPEED_KMH = 5;
  const WALKING_SPEED_MS = (WALKING_SPEED_KMH * 1000) / 3600;
  startTime = Cesium.JulianDate.now();
  let cumulativeTime = 0;

  const trackPointsWithTime = trackPoints.map((point, i) => {
    if (i === 0) {
      point.time = Cesium.JulianDate.toIso8601(startTime);
      return point;
    }

    const prevPos = Cesium.Cartographic.fromDegrees(
      trackPoints[i - 1].lon,
      trackPoints[i - 1].lat,
      trackPoints[i - 1].ele
    );
    const currPos = Cesium.Cartographic.fromDegrees(
      point.lon,
      point.lat,
      point.ele
    );

    const distance = Cesium.Cartesian3.distance(
      Cesium.Cartesian3.fromRadians(prevPos.longitude, prevPos.latitude, prevPos.height),
      Cesium.Cartesian3.fromRadians(currPos.longitude, currPos.latitude, currPos.height)
    );

    const timeForSegment = distance / WALKING_SPEED_MS;
    cumulativeTime += timeForSegment;

    const pointTime = Cesium.JulianDate.addSeconds(startTime, cumulativeTime, new Cesium.JulianDate());
    point.time = Cesium.JulianDate.toIso8601(pointTime);
    return point;
  });

  stopTime = Cesium.JulianDate.fromIso8601(trackPointsWithTime[trackPointsWithTime.length - 1].time);
  return { startTime, stopTime, trackPointsWithTime };
}