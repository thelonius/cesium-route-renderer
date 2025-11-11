import { useState, useEffect } from 'react';
import * as Cesium from 'cesium';
import { TrackPoint } from '../types';
import { parseGPX, calculateTimestamps } from '../utils/gpxUtils';
import { parseKML } from '../utils/kmlUtils';

interface UseRouteResult {
  trackPoints: TrackPoint[];
  timeRange: { startTime: Cesium.JulianDate; stopTime: Cesium.JulianDate } | null;
  isLoading: boolean;
  error: string | null;
}

export function useRoute(routeUrl: string | null): UseRouteResult {
  const [trackPoints, setTrackPoints] = useState<TrackPoint[]>([]);
  const [timeRange, setTimeRange] = useState<{ startTime: Cesium.JulianDate; stopTime: Cesium.JulianDate } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!routeUrl) {
      setTrackPoints([]);
      setTimeRange(null);
      setError(null);
      return;
    }

    const loadRoute = async () => {
      setIsLoading(true);
      setError(null);

      try {
        // Auto-detect file format from extension first
        let isKML = routeUrl.toLowerCase().endsWith('.kml');

        // If not obvious from extension, check content
        if (!isKML && !routeUrl.toLowerCase().endsWith('.gpx')) {
          const response = await fetch(routeUrl);
          const text = await response.text();
          isKML = text.includes('<kml') || text.includes('<kml:');
          console.log(`Auto-detected format from content: ${isKML ? 'KML' : 'GPX'}`);
        }

        const fileType = isKML ? 'KML' : 'GPX';
        console.log(`Loading ${fileType} file: ${routeUrl}`);

        // Parse based on file type
        const points = isKML ? await parseKML(routeUrl) : await parseGPX(routeUrl);

        if (points.length === 0) {
          throw new Error(`No track points found in ${fileType} file`);
        }

        const { startTime, stopTime, trackPointsWithTime } = calculateTimestamps(points);
        setTrackPoints(trackPointsWithTime);
        setTimeRange({ startTime, stopTime });

        console.log(`Successfully loaded ${trackPointsWithTime.length} points from ${fileType}`);
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Failed to load route file');
        setTrackPoints([]);
        setTimeRange(null);
      } finally {
        setIsLoading(false);
      }
    };

    loadRoute();
  }, [routeUrl]);

  return { trackPoints, timeRange, isLoading, error };
}