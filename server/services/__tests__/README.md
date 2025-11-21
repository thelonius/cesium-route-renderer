# Unit Tests

## Overview
Comprehensive test suite for critical services in the route rendering application.

## Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage report
npm run test:coverage
```

## Test Coverage

### Services Tested

#### 1. **routeAnalyzerService.test.js**
- Pattern detection (technical_climb, alpine_ridge, switchback, valley, flat)
- Animation speed calculation
- Analysis validation
- Overlay data generation

#### 2. **renderOrchestratorService.test.js**
- Full pipeline execution (5 stages)
- Progress tracking (0-100%)
- Active render management
- Stage transitions
- Error handling
- Render cancellation

#### 3. **memoryMonitorService.test.js**
- Monitor lifecycle (create, stop, cleanup)
- Memory measurement tracking
- Threshold detection (warning/critical)
- Trend analysis
- Moving averages
- Global statistics
- Historical data retention

## Test Structure

```
server/services/__tests__/
├── routeAnalyzerService.test.js     (11 test cases)
├── renderOrchestratorService.test.js (14 test cases)
└── memoryMonitorService.test.js     (20 test cases)
```

Total: **45 test cases** covering critical functionality.

## Coverage Goals

- **Statements**: > 80%
- **Branches**: > 75%
- **Functions**: > 80%
- **Lines**: > 80%

## Mock Strategy

Tests use Jest mocks for external dependencies:
- `dockerService` - Mocked container operations
- `gpxService` - Mocked file parsing
- File system operations - Mocked I/O
- Timer functions - Mocked for deterministic tests

## Writing New Tests

### Test Template

```javascript
describe('ServiceName', () => {
  beforeEach(() => {
    // Setup
  });

  afterEach(() => {
    // Cleanup
  });

  describe('methodName', () => {
    test('should do something specific', () => {
      // Arrange
      const input = {};
      
      // Act
      const result = service.method(input);
      
      // Assert
      expect(result).toBe(expected);
    });
  });
});
```

## CI/CD Integration

Tests run automatically on:
- Pre-commit hooks
- Pull request validation
- Pre-deployment checks

## Troubleshooting

### Common Issues

**Issue**: `Cannot find module` errors
**Solution**: Run `npm install` to install Jest dependencies

**Issue**: Timeout errors in async tests
**Solution**: Increase timeout with `jest.setTimeout(10000)` or use `done` callback

**Issue**: Mock not resetting between tests
**Solution**: Ensure `clearMocks: true` in jest.config.js

## Future Test Additions

- [ ] Camera service tests (keyframe generation, interpolation)
- [ ] Docker service integration tests
- [ ] GPX parsing edge cases
- [ ] Telegram bot service tests
- [ ] End-to-end render pipeline tests
- [ ] Performance benchmarks
