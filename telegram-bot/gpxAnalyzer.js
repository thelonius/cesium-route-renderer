/**
 * GPX Track Analyzer
 * Analyzes GPX files to provide detailed statistics and timestamp quality assessment
 */

/**
 * Calculate distance between two lat/lon points using Haversine formula
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth radius in meters
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c; // Distance in meters
}

/**
 * Analyze timestamp quality and characteristics
 */
function analyzeTimestamps(points) {
  if (!points || points.length < 2) {
    return {
      status: 'absent',
      quality: 'none',
      hasTimestamps: false,
      reason: 'No track points found'
    };
  }

  // Check if timestamps exist
  const pointsWithTime = points.filter(p => p.time);
  if (pointsWithTime.length === 0) {
    return {
      status: 'absent',
      quality: 'none',
      hasTimestamps: false,
      reason: 'No timestamps in GPX file'
    };
  }

  if (pointsWithTime.length < points.length) {
    return {
      status: 'partial',
      quality: 'poor',
      hasTimestamps: true,
      timestampedPoints: pointsWithTime.length,
      totalPoints: points.length,
      reason: `Only ${pointsWithTime.length} of ${points.length} points have timestamps`
    };
  }

  // All points have timestamps - now check quality
  const times = points.map(p => new Date(p.time).getTime());
  const timeDifferences = [];

  for (let i = 1; i < times.length; i++) {
    timeDifferences.push(times[i] - times[i-1]);
  }

  const avgTimeDiff = timeDifferences.reduce((a, b) => a + b, 0) / timeDifferences.length;
  const minTimeDiff = Math.min(...timeDifferences);
  const maxTimeDiff = Math.max(...timeDifferences);

  // Check if all timestamps are the same or too close
  const uniqueTimes = new Set(times);
  if (uniqueTimes.size === 1) {
    return {
      status: 'same',
      quality: 'invalid',
      hasTimestamps: true,
      reason: 'All timestamps are identical',
      timestamp: new Date(times[0]).toISOString()
    };
  }

  if (uniqueTimes.size < points.length * 0.1) {
    return {
      status: 'too_close',
      quality: 'invalid',
      hasTimestamps: true,
      reason: `Too many duplicate timestamps (${uniqueTimes.size} unique out of ${points.length})`,
      uniqueCount: uniqueTimes.size,
      totalCount: points.length
    };
  }

  // Check for negative time differences (timestamps going backwards)
  const negativeCount = timeDifferences.filter(d => d < 0).length;
  if (negativeCount > 0) {
    return {
      status: 'backwards',
      quality: 'invalid',
      hasTimestamps: true,
      reason: `${negativeCount} timestamps go backwards`,
      negativeCount
    };
  }

  // Check if timestamps are too close relative to distances
  const speeds = [];
  for (let i = 1; i < points.length; i++) {
    const distance = calculateDistance(
      points[i-1].lat, points[i-1].lon,
      points[i].lat, points[i].lon
    );
    const timeDiff = (times[i] - times[i-1]) / 1000; // seconds
    if (timeDiff > 0) {
      const speed = distance / timeDiff; // m/s
      speeds.push(speed);
    }
  }

  const maxReasonableSpeed = 50; // 50 m/s = 180 km/h (max for any hiking/biking/driving)
  const unreasonableSpeeds = speeds.filter(s => s > maxReasonableSpeed);

  if (unreasonableSpeeds.length > speeds.length * 0.1) {
    return {
      status: 'erroneous',
      quality: 'poor',
      hasTimestamps: true,
      reason: `${unreasonableSpeeds.length} segments have unrealistic speeds (>${maxReasonableSpeed} m/s)`,
      maxSpeed: Math.max(...speeds).toFixed(1),
      avgSpeed: (speeds.reduce((a,b) => a+b, 0) / speeds.length).toFixed(1)
    };
  }

  // Timestamps appear valid
  const totalDuration = (times[times.length - 1] - times[0]) / 1000 / 60; // minutes
  return {
    status: 'valid',
    quality: 'good',
    hasTimestamps: true,
    reason: 'Timestamps are consistent and realistic',
    duration: totalDuration,
    avgInterval: avgTimeDiff / 1000, // seconds
    minInterval: minTimeDiff / 1000,
    maxInterval: maxTimeDiff / 1000,
    avgSpeed: speeds.length > 0 ? (speeds.reduce((a,b) => a+b, 0) / speeds.length).toFixed(2) : 0
  };
}

/**
 * Main analysis function
 */
function analyzeGPX(gpxContent) {
  try {
    // Extract track points
    const trkptMatches = gpxContent.match(/<trkpt[^>]*lat="([^"]+)"[^>]*lon="([^"]+)"[^>]*>[\s\S]*?<\/trkpt>/g);

    if (!trkptMatches || trkptMatches.length === 0) {
      return {
        success: false,
        error: 'No track points found in GPX file'
      };
    }

    const points = trkptMatches.map(match => {
      const latMatch = match.match(/lat="([^"]+)"/);
      const lonMatch = match.match(/lon="([^"]+)"/);
      const eleMatch = match.match(/<ele>([^<]+)<\/ele>/);
      const timeMatch = match.match(/<time>([^<]+)<\/time>/);

      return {
        lat: parseFloat(latMatch[1]),
        lon: parseFloat(lonMatch[1]),
        ele: eleMatch ? parseFloat(eleMatch[1]) : 0,
        time: timeMatch ? timeMatch[1] : null
      };
    });

    // Calculate total distance
    let totalDistance = 0;
    let elevationGain = 0;
    let elevationLoss = 0;
    let minEle = points[0].ele;
    let maxEle = points[0].ele;

    for (let i = 1; i < points.length; i++) {
      // Distance
      const distance = calculateDistance(
        points[i-1].lat, points[i-1].lon,
        points[i].lat, points[i].lon
      );
      totalDistance += distance;

      // Elevation
      const elevationDiff = points[i].ele - points[i-1].ele;
      if (elevationDiff > 0) {
        elevationGain += elevationDiff;
      } else {
        elevationLoss += Math.abs(elevationDiff);
      }

      minEle = Math.min(minEle, points[i].ele);
      maxEle = Math.max(maxEle, points[i].ele);
    }

    // Analyze timestamps
    const timestampAnalysis = analyzeTimestamps(points);

    // Estimate duration based on distance if timestamps are invalid
    let estimatedDuration = null;
    let durationSource = null;

    if (timestampAnalysis.status === 'valid') {
      estimatedDuration = timestampAnalysis.duration;
      durationSource = 'timestamps';
    } else {
      // Estimate based on distance and terrain
      const distanceKm = totalDistance / 1000;
      const avgGrade = totalDistance > 0 ? (elevationGain / totalDistance) * 100 : 0;

      // Adjust speed based on terrain difficulty
      let baseSpeed = 5; // km/h for flat terrain
      if (avgGrade > 10) {
        baseSpeed = 3; // steep terrain
      } else if (avgGrade > 5) {
        baseSpeed = 4; // moderate terrain
      }

      estimatedDuration = (distanceKm / baseSpeed) * 60; // minutes
      durationSource = 'distance_heuristic';
    }

    // Calculate bounding box
    const lats = points.map(p => p.lat);
    const lons = points.map(p => p.lon);
    const bounds = {
      north: Math.max(...lats),
      south: Math.min(...lats),
      east: Math.max(...lons),
      west: Math.min(...lons)
    };

    return {
      success: true,
      statistics: {
        points: points.length,
        distance: {
          total: totalDistance,
          km: (totalDistance / 1000).toFixed(2)
        },
        elevation: {
          gain: Math.round(elevationGain),
          loss: Math.round(elevationLoss),
          min: Math.round(minEle),
          max: Math.round(maxEle),
          range: Math.round(maxEle - minEle)
        },
        duration: {
          minutes: Math.round(estimatedDuration),
          hours: (estimatedDuration / 60).toFixed(1),
          source: durationSource
        },
        bounds
      },
      timestamps: timestampAnalysis,
      recommendation: getRecommendation(timestampAnalysis, estimatedDuration)
    };

  } catch (error) {
    return {
      success: false,
      error: `Failed to analyze GPX: ${error.message}`
    };
  }
}

/**
 * Generate recommendation message based on analysis
 */
function getRecommendation(timestampAnalysis, duration) {
  const durationHours = (duration / 60).toFixed(1);

  if (!timestampAnalysis.hasTimestamps || timestampAnalysis.quality === 'invalid') {
    return `⚠️ Using distance-based estimation (~${durationHours}h) as timestamps are ${timestampAnalysis.status}`;
  }

  if (timestampAnalysis.quality === 'poor') {
    return `⚠️ Timestamp quality is poor. Using hybrid estimation (~${durationHours}h)`;
  }

  return `✅ Using accurate timestamp-based duration (~${durationHours}h)`;
}

/**
 * Format analytics for user display
 */
function formatAnalytics(analysis) {
  if (!analysis.success) {
    return `❌ Error: ${analysis.error}`;
  }

  const stats = analysis.statistics;
  const ts = analysis.timestamps;

  let message = '📊 **Track Analytics**\n\n';

  // Basic stats
  message += `📍 **Route Info:**\n`;
  message += `• Distance: ${stats.distance.km} km\n`;
  message += `• Points: ${stats.points}\n`;
  message += `• Duration: ~${stats.duration.hours}h (${stats.duration.source === 'timestamps' ? 'from timestamps' : 'estimated'})\n\n`;

  // Elevation
  message += `⛰ **Elevation:**\n`;
  message += `• Gain: +${stats.elevation.gain}m\n`;
  message += `• Loss: -${stats.elevation.loss}m\n`;
  message += `• Range: ${stats.elevation.min}m - ${stats.elevation.max}m\n\n`;

  // Timestamp quality
  message += `⏱ **Timestamps:**\n`;
  message += `• Status: ${ts.status}\n`;
  message += `• Quality: ${ts.quality}\n`;
  message += `• Reason: ${ts.reason}\n\n`;

  // Recommendation
  message += `${analysis.recommendation}\n`;

  return message;
}

module.exports = {
  analyzeGPX,
  formatAnalytics,
  analyzeTimestamps,
  calculateDistance
};
