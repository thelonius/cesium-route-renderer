import * as Cesium from 'cesium';
import { TrackPoint } from '../types';

export async function parseKML(url: string): Promise<TrackPoint[]> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch KML file: ${response.status} ${response.statusText}`);
  }

  const kmlText = await response.text();

  console.log(`Fetched KML from ${url}, length: ${kmlText.length} bytes`);
  console.log('First 200 chars:', kmlText.substring(0, 200));

  // Check if the response is empty
  if (!kmlText || kmlText.trim().length === 0) {
    throw new Error(`KML file at ${url} is empty`);
  }

  // Check if we got HTML instead of XML
  const trimmedText = kmlText.trim();
  if (trimmedText.startsWith('<!DOCTYPE html') ||
      trimmedText.startsWith('<!doctype html') ||
      trimmedText.startsWith('<html')) {
    console.error('Received HTML instead of KML file');
    throw new Error(`KML file not found: "${url}". Make sure the file exists in the public folder.`);
  }

  const parser = new DOMParser();
  const kmlDoc = parser.parseFromString(kmlText, 'text/xml');

  // Check for XML parsing errors
  const parseErrors = kmlDoc.getElementsByTagName('parsererror');
  if (parseErrors.length > 0) {
    console.error('XML parse error details:', parseErrors[0].textContent);
    console.error('Problematic XML:', kmlText.substring(0, 500));
    throw new Error('Failed to parse KML XML - the file may be corrupted or invalid');
  }

  console.log('Root element:', kmlDoc.documentElement.nodeName);

  // Verify it's actually a KML file
  if (kmlDoc.documentElement.nodeName.toLowerCase() !== 'kml') {
    throw new Error(`Invalid KML file: root element is '${kmlDoc.documentElement.nodeName}', expected 'kml'`);
  }

  const trackPoints: TrackPoint[] = [];

  // Try to parse Google Earth Track (gx:Track with when/gx:coord elements)
  const gxTracks = kmlDoc.getElementsByTagName('gx:Track');
  if (gxTracks.length > 0) {
    console.log('Found gx:Track elements, parsing Google Earth track format');
    return parseGxTrack(gxTracks[0]);
  }

  // Try to parse standard LineString with coordinates
  const lineStrings = kmlDoc.getElementsByTagName('LineString');
  if (lineStrings.length > 0) {
    console.log('Found LineString elements, parsing standard KML format');
    return parseLineString(lineStrings[0]);
  }

  // Try to parse MultiGeometry
  const multiGeometry = kmlDoc.getElementsByTagName('MultiGeometry');
  if (multiGeometry.length > 0) {
    const lineStringsInMulti = multiGeometry[0].getElementsByTagName('LineString');
    if (lineStringsInMulti.length > 0) {
      console.log('Found LineString in MultiGeometry, parsing');
      return parseLineString(lineStringsInMulti[0]);
    }
  }

  console.error('No track data found in KML file');
  console.log('KML structure:', kmlDoc.documentElement.outerHTML.substring(0, 500));
  throw new Error('No track data found in KML file (no gx:Track or LineString elements)');
}

function parseGxTrack(gxTrack: Element): TrackPoint[] {
  const trackPoints: TrackPoint[] = [];
  
  // Get timestamps
  const whenElements = gxTrack.getElementsByTagName('when');
  const timestamps = Array.from(whenElements).map(el => el.textContent || '');
  
  // Get coordinates (gx:coord format: lon lat ele)
  const coordElements = gxTrack.getElementsByTagName('gx:coord');
  const coords = Array.from(coordElements).map(el => {
    const coordText = el.textContent || '';
    const parts = coordText.trim().split(/\s+/);
    return {
      lon: parseFloat(parts[0] || '0'),
      lat: parseFloat(parts[1] || '0'),
      ele: parseFloat(parts[2] || '0')
    };
  });

  // Combine timestamps and coordinates
  const pointCount = Math.min(timestamps.length, coords.length);
  console.log(`Found ${pointCount} track points with timestamps in gx:Track`);

  for (let i = 0; i < pointCount; i++) {
    trackPoints.push({
      lat: coords[i].lat,
      lon: coords[i].lon,
      ele: coords[i].ele,
      time: timestamps[i]
    });
  }

  return trackPoints;
}

function parseLineString(lineString: Element): TrackPoint[] {
  const trackPoints: TrackPoint[] = [];
  
  // Get coordinates element
  const coordsElement = lineString.getElementsByTagName('coordinates')[0];
  if (!coordsElement || !coordsElement.textContent) {
    throw new Error('No coordinates found in LineString');
  }

  // KML coordinates format: lon,lat,ele lon,lat,ele (space or newline separated)
  const coordText = coordsElement.textContent.trim();
  const coordPairs = coordText.split(/\s+/).filter(s => s.length > 0);

  console.log(`Found ${coordPairs.length} coordinate pairs in LineString`);

  coordPairs.forEach(pair => {
    const parts = pair.split(',');
    if (parts.length >= 2) {
      trackPoints.push({
        lon: parseFloat(parts[0]),
        lat: parseFloat(parts[1]),
        ele: parseFloat(parts[2] || '0'),
        time: '' // No timestamps in basic LineString
      });
    }
  });

  console.log(`Successfully parsed ${trackPoints.length} track points from LineString`);
  return trackPoints;
}
