const routeAnalyzerService = require('../routeAnalyzerService');

describe('RouteAnalyzerService', () => {
  describe('analyzeRoutePattern', () => {
    test('detects technical climb pattern with steep elevation gain', () => {
      const analysis = {
        statistics: {
          distance: { total: 5000 },
          elevation: { 
            gain: 800,
            loss: 100,
            min: 1000,
            max: 1800
          },
          duration: { hours: 3, minutes: 180 }
        },
        segments: {
          climbs: [{ elevationGain: 600, averageGrade: 15 }],
          descents: [],
          flat: []
        }
      };

      const pattern = routeAnalyzerService.analyzeRoutePattern(analysis);
      
      expect(pattern).toBe('technical_climb');
    });

    test('detects alpine ridge pattern with high elevation and moderate distance', () => {
      const analysis = {
        statistics: {
          distance: { total: 8000 },
          elevation: { 
            gain: 400,
            loss: 400,
            min: 2400,
            max: 2800
          },
          duration: { hours: 4, minutes: 240 }
        },
        segments: {
          climbs: [{ elevationGain: 200 }],
          descents: [{ elevationLoss: 200 }],
          flat: []
        }
      };

      const pattern = routeAnalyzerService.analyzeRoutePattern(analysis);
      
      expect(pattern).toBe('alpine_ridge');
    });

    test('detects switchback section with many turns', () => {
      const analysis = {
        statistics: {
          distance: { total: 3000 },
          elevation: { 
            gain: 400,
            loss: 50,
            min: 1000,
            max: 1400
          },
          duration: { hours: 2, minutes: 120 }
        },
        segments: {
          climbs: [{ elevationGain: 300, averageGrade: 18 }],
          descents: [],
          flat: []
        },
        turns: Array(12).fill({ angle: 45 })
      };

      const pattern = routeAnalyzerService.analyzeRoutePattern(analysis);
      
      expect(pattern).toBe('switchback_section');
    });

    test('detects valley traverse with low elevation', () => {
      const analysis = {
        statistics: {
          distance: { total: 12000 },
          elevation: { 
            gain: 150,
            loss: 150,
            min: 400,
            max: 550
          },
          duration: { hours: 3, minutes: 180 }
        },
        segments: {
          climbs: [],
          descents: [],
          flat: [{ distance: 10000 }]
        }
      };

      const pattern = routeAnalyzerService.analyzeRoutePattern(analysis);
      
      expect(pattern).toBe('valley_traverse');
    });

    test('detects flat approach with minimal elevation change', () => {
      const analysis = {
        statistics: {
          distance: { total: 5000 },
          elevation: { 
            gain: 50,
            loss: 40,
            min: 200,
            max: 250
          },
          duration: { hours: 1.5, minutes: 90 }
        },
        segments: {
          climbs: [],
          descents: [],
          flat: [{ distance: 4800 }]
        }
      };

      const pattern = routeAnalyzerService.analyzeRoutePattern(analysis);
      
      expect(pattern).toBe('flat_approach');
    });

    test('returns unknown for ambiguous patterns', () => {
      const analysis = {
        statistics: {
          distance: { total: 1000 },
          elevation: { gain: 10, loss: 10, min: 500, max: 510 },
          duration: { hours: 0.5, minutes: 30 }
        },
        segments: { climbs: [], descents: [], flat: [] }
      };

      const pattern = routeAnalyzerService.analyzeRoutePattern(analysis);
      
      expect(pattern).toBe('unknown');
    });
  });

  describe('calculateAnimationSpeed', () => {
    test('uses default speed for short routes', () => {
      const routeDurationMinutes = 45;
      
      const speed = routeAnalyzerService.calculateAnimationSpeed(routeDurationMinutes);
      
      expect(speed).toBe(2);
    });

    test('increases speed for long routes to fit video duration', () => {
      const routeDurationMinutes = 600; // 10 hours
      
      const speed = routeAnalyzerService.calculateAnimationSpeed(routeDurationMinutes);
      
      expect(speed).toBeGreaterThan(2);
      expect(speed).toBeLessThanOrEqual(10);
    });

    test('caps speed at maximum', () => {
      const routeDurationMinutes = 2000; // 33+ hours
      
      const speed = routeAnalyzerService.calculateAnimationSpeed(routeDurationMinutes);
      
      expect(speed).toBe(10);
    });

    test('calculates video duration correctly with adaptive speed', () => {
      const routeDurationMinutes = 300; // 5 hours
      
      const speed = routeAnalyzerService.calculateAnimationSpeed(routeDurationMinutes);
      const videoDuration = routeDurationMinutes / speed;
      
      expect(videoDuration).toBeLessThanOrEqual(60);
      expect(videoDuration).toBeGreaterThan(0);
    });
  });

  describe('validateAnalysis', () => {
    test('validates complete analysis object', () => {
      const analysis = {
        statistics: {
          distance: { total: 5000 },
          elevation: { gain: 500, loss: 100, min: 1000, max: 1500 },
          duration: { hours: 3, minutes: 180 }
        },
        segments: { climbs: [], descents: [], flat: [] }
      };

      const isValid = routeAnalyzerService.validateAnalysis(analysis);
      
      expect(isValid).toBe(true);
    });

    test('rejects analysis with missing statistics', () => {
      const analysis = {
        segments: { climbs: [], descents: [], flat: [] }
      };

      const isValid = routeAnalyzerService.validateAnalysis(analysis);
      
      expect(isValid).toBe(false);
    });

    test('rejects analysis with invalid elevation data', () => {
      const analysis = {
        statistics: {
          distance: { total: 5000 },
          elevation: { gain: -100, loss: 100 },
          duration: { hours: 3, minutes: 180 }
        },
        segments: { climbs: [], descents: [], flat: [] }
      };

      const isValid = routeAnalyzerService.validateAnalysis(analysis);
      
      expect(isValid).toBe(false);
    });

    test('rejects analysis with missing segments', () => {
      const analysis = {
        statistics: {
          distance: { total: 5000 },
          elevation: { gain: 500, loss: 100, min: 1000, max: 1500 },
          duration: { hours: 3, minutes: 180 }
        }
      };

      const isValid = routeAnalyzerService.validateAnalysis(analysis);
      
      expect(isValid).toBe(false);
    });
  });

  describe('generateOverlayData', () => {
    test('generates overlay with all required fields', () => {
      const analysis = {
        statistics: {
          distance: { total: 5000 },
          elevation: { gain: 500, loss: 100 },
          duration: { hours: 3, minutes: 180 },
          speed: { average: 1.67 }
        }
      };

      const overlay = routeAnalyzerService.generateOverlayData(analysis);
      
      expect(overlay).toHaveProperty('distance');
      expect(overlay).toHaveProperty('elevationGain');
      expect(overlay).toHaveProperty('elevationLoss');
      expect(overlay).toHaveProperty('duration');
      expect(overlay).toHaveProperty('averageSpeed');
    });

    test('formats values correctly', () => {
      const analysis = {
        statistics: {
          distance: { total: 5432 },
          elevation: { gain: 567, loss: 123 },
          duration: { hours: 3, minutes: 187 },
          speed: { average: 1.756 }
        }
      };

      const overlay = routeAnalyzerService.generateOverlayData(analysis);
      
      expect(overlay.distance).toMatch(/5\.43 km/);
      expect(overlay.elevationGain).toMatch(/567 m/);
      expect(overlay.duration).toMatch(/3h 7m/);
    });
  });
});
