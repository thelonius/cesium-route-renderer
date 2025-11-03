import { useState, useEffect } from 'react';
import * as Cesium from 'cesium';
import { TrackPoint } from '../types';
import { parseGPX, calculateTimestamps } from '../utils/gpxUtils';

interface UseRouteResult {
  trackPoints: TrackPoint[];
  timeRange: { startTime: Cesium.JulianDate; stopTime: Cesium.JulianDate } | null;
  isLoading: boolean;
  error: string | null;
}

export function useRoute(gpxUrl: string | null): UseRouteResult {
  const [trackPoints, setTrackPoints] = useState<TrackPoint[]>([]);
  const [timeRange, setTimeRange] = useState<{ startTime: Cesium.JulianDate; stopTime: Cesium.JulianDate } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!gpxUrl) {
      setTrackPoints([]);
      setTimeRange(null);
      setError(null);
      return;
    }

    const loadRoute = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const points = await parseGPX(gpxUrl);
        if (points.length === 0) {
          throw new Error('No track points found in GPX file');
        }

        const { startTime, stopTime, trackPointsWithTime } = calculateTimestamps(points);
        setTrackPoints(trackPointsWithTime);
        setTimeRange({ startTime, stopTime });
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Failed to load GPX file');
        setTrackPoints([]);
        setTimeRange(null);
      } finally {
        setIsLoading(false);
      }
    };

    loadRoute();
  }, [gpxUrl]);

  return { trackPoints, timeRange, isLoading, error };
}