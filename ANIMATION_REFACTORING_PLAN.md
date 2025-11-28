# Animation System Refactoring Plan

## Current State Analysis

### Problems Identified

#### 1. **Dual Time-Stepping System** (Major Complexity)
- **TICK_DEPENDENT mode**: Cesium's built-in time advancement using `clock.multiplier`
- **Manual stepping**: Custom per-frame time advancement in `postRenderListener`
- **Issue**: Two systems doing the same job, creates confusion and bugs
- **When**: Manual stepping triggers for speeds > 100x in headless mode

#### 2. **Scattered State Management**
Multiple overlapping flags tracking animation state:
```typescript
- isInitialAnimationRef      // Intro animation running
- isEndingAnimationRef        // Outro animation running
- animationStartedRef         // General animation started
- CESIUM_ANIMATION_COMPLETE   // Global completion flag
- CESIUM_INTRO_COMPLETE       // Intro done
- CESIUM_ANIMATION_READY      // Ready to start
- skipIntro / skipOutro       // Skip flags
```

#### 3. **Intro/Outro Implementation**
- **Intro**: Uses `requestAnimationFrame` loop (lines 142-227)
- **Outro**: Uses `setInterval` (lines 825-885)
- **Issue**: Different timing mechanisms, both disabled by default
- **Camera control**: Scattered across multiple functions

#### 4. **Clock Range Not Consistently Reset**
- Set on init (line 291)
- Reset on restart (line 254)
- Missing from some code paths → causes looping bugs

#### 5. **Dead Code**
- Lines 332-389: Commented-out filtering logic
- Various disabled features kept in codebase

---

## Proposed Refactoring

### Phase 1: Simplify Time System ✅ (Priority: HIGH)

**Goal**: Single, unified time-stepping mechanism

#### Option A: Remove Manual Stepping (Recommended)
- Keep only TICK_DEPENDENT mode
- Use dynamic `clock.multiplier` adjustment for all speeds
- Remove: `manualStepEnabledRef`, `savedMultiplierRef`, manual stepping logic

**Benefits**:
- Simpler codebase
- Leverage Cesium's built-in optimizations
- Easier to debug

**Risks**:
- May need testing for very high speeds (>1000x)
- Headless rendering might need validation

#### Option B: Manual Stepping Only
- Remove TICK_DEPENDENT, use only manual stepping
- Full control over time advancement

**Benefits**:
- Predictable behavior at all speeds
- Fine-grained control

**Drawbacks**:
- More complex
- Reimplements Cesium functionality

**Decision**: **Option A** - Trust Cesium's TICK_DEPENDENT, remove manual stepping

---

### Phase 2: State Machine ✅ (Priority: HIGH)

**Goal**: Clear animation lifecycle

```typescript
enum AnimationPhase {
  NOT_STARTED = 'not_started',
  INTRO = 'intro',           // 3s intro animation
  PLAYING = 'playing',       // Main route animation
  OUTRO = 'outro',           // 7s outro animation (optional)
  COMPLETE = 'complete'      // Animation finished
}

const [animationPhase, setAnimationPhase] = useState<AnimationPhase>(AnimationPhase.NOT_STARTED);
```

**Benefits**:
- Single source of truth for state
- Easy to understand current phase
- Clear transitions

**Implementation**:
```typescript
// Replace 7 different flags with one state
const phaseRef = useRef<AnimationPhase>(AnimationPhase.NOT_STARTED);

// Clear transition functions
function startIntro() { phaseRef.current = AnimationPhase.INTRO; }
function startPlaying() { phaseRef.current = AnimationPhase.PLAYING; }
function startOutro() { phaseRef.current = AnimationPhase.OUTRO; }
function complete() { phaseRef.current = AnimationPhase.COMPLETE; }
```

---

### Phase 3: Unified Intro/Outro System (Priority: MEDIUM)

**Goal**: Consistent camera animation mechanism

#### Current Issues:
- Intro uses `requestAnimationFrame` (60fps)
- Outro uses `setInterval` (10fps)
- Different easing functions
- Outro disabled by default, has bugs

#### Proposed Solution:
```typescript
class CameraAnimation {
  constructor(
    viewer: Cesium.Viewer,
    duration: number,
    onUpdate: (progress: number) => void,
    onComplete: () => void
  ) {}

  start() {
    // Use requestAnimationFrame for both intro/outro
    // Consistent 60fps, smooth animations
  }

  stop() {}
}

// Usage:
const intro = new CameraAnimation(viewer, 3, (progress) => {
  // Move from vertical → angled view
  updateCameraForIntro(progress);
}, () => {
  setAnimationPhase(AnimationPhase.PLAYING);
});

const outro = new CameraAnimation(viewer, 7, (progress) => {
  // Tilt camera to face down
  updateCameraForOutro(progress);
}, () => {
  setAnimationPhase(AnimationPhase.COMPLETE);
});
```

**Benefits**:
- Reusable animation class
- Consistent timing
- Easier to add new animations
- Simpler to test

---

### Phase 4: Clean Up (Priority: LOW)

**Remove**:
- Lines 332-389: Commented filtering code
- Unused refs and state
- Debug logging (or make conditional on env var)
- Duplicate state tracking

**Consolidate**:
- Camera positioning logic into dedicated functions
- Status display into separate module
- Constants into config file

---

## Migration Strategy

### Step 1: Create Feature Branch ✅
```bash
git checkout -b refactor-animation-system
```

### Step 2: Add Tests (Optional but Recommended)
- Test intro animation
- Test route playback
- Test restart functionality
- Test high-speed playback (>1000x)

### Step 3: Incremental Refactoring
Do NOT refactor everything at once. Small, testable steps:

1. **Remove manual stepping** (1-2 hours)
   - Remove `manualStepEnabledRef` logic
   - Remove custom time advancement
   - Test at various speeds

2. **Implement state machine** (2-3 hours)
   - Add `AnimationPhase` enum
   - Replace all state flags
   - Update transitions

3. **Unify intro/outro** (3-4 hours)
   - Create `CameraAnimation` class
   - Refactor intro to use it
   - Implement proper outro
   - Test both

4. **Clean up** (1-2 hours)
   - Remove dead code
   - Consolidate functions
   - Update comments

### Step 4: Testing Checklist
- [ ] Intro plays smoothly (when enabled)
- [ ] Route animates at correct speed
- [ ] Restart (R key) works correctly
- [ ] Animation stops at end (no looping)
- [ ] Outro plays smoothly (when enabled)
- [ ] Works in headless/Docker mode
- [ ] High speeds (>1000x) work correctly
- [ ] Multiple route formats (GPX, KML, etc.)

### Step 5: Merge
```bash
git checkout add-intro-outro
git merge refactor-animation-system
```

---

## Post-Refactoring: Proper Outro Implementation

After refactoring, implementing outro will be much simpler:

```typescript
function updateCameraForOutro(progress: number) {
  // Eased progress: cubic ease-in for settling motion
  const eased = Math.pow(progress, 3);

  // Keep camera at same position
  const position = viewer.camera.position.clone();

  // Interpolate direction from current to straight down
  const targetDirection = Cesium.Cartesian3.subtract(
    hikerFinalPosition,
    position,
    new Cesium.Cartesian3()
  );
  Cesium.Cartesian3.normalize(targetDirection, targetDirection);

  const currentDirection = viewer.camera.direction;
  const newDirection = Cesium.Cartesian3.lerp(
    currentDirection,
    targetDirection,
    eased,
    new Cesium.Cartesian3()
  );

  viewer.camera.direction = newDirection;

  // Interpolate up vector toward north
  const newUp = Cesium.Cartesian3.lerp(
    viewer.camera.up,
    Cesium.Cartesian3.UNIT_Z,
    eased,
    new Cesium.Cartesian3()
  );

  viewer.camera.up = newUp;
}
```

**Why this works after refactoring**:
- Clean state management: Easy to know when to trigger
- Unified animation system: Same mechanism as intro
- No dual time-stepping: No conflicts with manual stepping
- Clear lifecycle: PLAYING → OUTRO → COMPLETE

---

## Estimated Timeline

- **Phase 1** (Remove manual stepping): 2-3 hours
- **Phase 2** (State machine): 3-4 hours
- **Phase 3** (Unified animations): 4-5 hours
- **Phase 4** (Cleanup): 2-3 hours
- **Testing**: 2-3 hours

**Total**: ~15-20 hours of work

---

## Questions to Answer Before Starting

1. **Do we need high-speed playback (>1000x)?**
   - If yes: Keep manual stepping option
   - If no: Remove it entirely

2. **Are intro/outro animations required features?**
   - If yes: Implement properly in Phase 3
   - If no: Remove entirely, simplify further

3. **What's the primary use case?**
   - Development: Speed/simplicity prioritized
   - Production rendering: Reliability/consistency prioritized
   - Both: Need comprehensive testing

4. **Headless rendering requirements?**
   - Must work in Docker/headless
   - Needs frame-by-frame control
   - Affects time-stepping approach

---

## Conclusion

Yes, refactoring first makes sense! The current system has accumulated complexity that makes adding features (like outro) difficult and error-prone. A clean refactor will:

1. ✅ Make the codebase easier to understand
2. ✅ Remove duplicate/conflicting systems
3. ✅ Enable proper outro implementation
4. ✅ Reduce bugs (like the looping issue)
5. ✅ Make future changes easier

**Recommendation**: Start with Phase 1 (remove manual stepping) as a proof-of-concept. If that works well, proceed with phases 2-4.
