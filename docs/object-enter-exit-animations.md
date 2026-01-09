# Object Enter/Exit Animations - Implementation Plan

## Overview

This document describes how to implement smooth animations for objects that enter or exit grid boundaries during push operations. The system already has all the necessary infrastructure - this plan shows how to connect the pieces.

## Current State

### What We Have

1. **Push Chain Metadata** (`push.ts:30-36`)
   - Each `PushChainEntry` contains:
     - `position`: The cell position
     - `cell`: The cell content (Concrete, Ref, or Empty)
     - `transition`: How we got there (`'enter' | 'exit' | 'move' | null`)
   - This tells us **exactly which objects undergo enter/exit transitions**

2. **Hierarchy Helpers**
   - `getScaleAndOffset(store, viewPath)` - Returns grid center and dimensions in world coordinates
   - `HierarchyHelper` - Navigation through grid hierarchy
   - Both already used for camera animations

3. **Animation System** (`demo-iso.ts:866-932`)
   - Already animates objects moving within the same grid
   - Uses "previous to current location" pattern
   - Creates animation clips with keyframes

4. **Camera View Tracking** (`demo-iso.ts:62`)
   - `currentViewPath` tracks which grids are visible
   - Updated by camera controller during enter/exit

### What's Missing

Currently, enter/exit transitions **skip object animation** and only animate the camera (see `demo-iso.ts:597-599`):

```typescript
// Skip animations for enter/exit transitions - we only animate simple moves
if (nextEntry.transition === 'enter' || nextEntry.transition === 'exit') {
  console.log(`  Skipping animation...`);
  continue;
}
```

## The Plan

### Core Concept

Just like within-grid animations, enter/exit animations need:
- **Previous location**: Cell's world position in the old view
- **Current location**: Cell's world position in the new view
- **Animation path**: Smooth interpolation between the two

The key insight: **both the camera and objects animate simultaneously**, creating a cohesive zoom-in or zoom-out effect.

### Step 1: Create Helper Function

Add a utility to convert cell positions to world coordinates:

```typescript
/**
 * Get world coordinates for a cell in a specific view.
 *
 * @param store - Grid store
 * @param viewPath - Hierarchy path to the grid (e.g., ['main', 'inner'])
 * @param cellPosition - The cell position
 * @returns World coordinates { x, y, z } or null if invalid
 */
function getCellWorldPosition(
  store: GridStore,
  viewPath: ViewPath,
  cellPosition: CellPosition
): { x: number; y: number; z: number } | null {
  // Get grid's position and scale in the hierarchy
  const scaleResult = getScaleAndOffset(store, viewPath);
  if (!scaleResult) return null;

  const grid = getGrid(store, cellPosition.gridId);
  if (!grid) return null;

  // Calculate cell dimensions within this view
  const cellWidth = scaleResult.width / grid.cols;
  const cellHeight = scaleResult.height / grid.rows;

  // Calculate cell center in world coordinates
  // scaleResult.centerX/Y is in grid-relative coords, convert to world
  const rootGrid = getGrid(store, viewPath[0]);
  if (!rootGrid) return null;

  // World coordinates have grid center at (0, 0)
  const worldOffsetX = scaleResult.centerX - rootGrid.cols / 2;
  const worldOffsetZ = scaleResult.centerY - rootGrid.rows / 2;

  // Cell position within the grid
  const cellLocalX = (cellPosition.col - grid.cols / 2 + 0.5) * cellWidth;
  const cellLocalZ = (cellPosition.row - grid.rows / 2 + 0.5) * cellHeight;

  return {
    x: worldOffsetX + cellLocalX,
    y: 0, // Always 0 for isometric ground plane
    z: worldOffsetZ + cellLocalZ
  };
}
```

**Location**: Add to `web/src/lib/camera/scale-helper.ts` or create new `web/src/lib/camera/world-position-helper.ts`

### Step 2: Extend chainToMovements()

Update the current `chainToMovements()` function to handle enter/exit transitions:

```typescript
private chainToMovements(
  chain: PushChain,
  previousViewPath: ViewPath,  // NEW: Previous camera view
  currentViewPath: ViewPath     // NEW: Current camera view
): Array<{
  cellId: string;
  oldPos: [number, number, number];  // World coordinates
  newPos: [number, number, number];  // World coordinates
}> {
  const movements: Array<...> = [];

  for (let i = 0; i < chain.length; i++) {
    const entry = chain[i];
    const cell = entry.cell;
    const oldCellPos = entry.position;

    const nextIndex = (i + 1) % chain.length;
    const nextEntry = chain[nextIndex];
    const newCellPos = nextEntry.position;

    // Skip empty cells
    if (cell.type === 'empty') continue;

    // Generate cell ID (same as before)
    const cellId = /* ... */;

    // NEW: Calculate world positions based on transition type
    let oldWorldPos: { x, y, z } | null = null;
    let newWorldPos: { x, y, z } | null = null;

    // Determine which view path to use for old position
    if (entry.transition === 'exit') {
      // Object was in child grid, calculate position in previous view
      // (which showed the child grid)
      oldWorldPos = getCellWorldPosition(store, previousViewPath, oldCellPos);
    } else {
      // Normal case: use current view for old position
      oldWorldPos = getCellWorldPosition(store, currentViewPath, oldCellPos);
    }

    // Determine which view path to use for new position
    if (nextEntry.transition === 'enter') {
      // Object is entering a child grid, calculate position in current view
      // (which now shows the child grid)
      newWorldPos = getCellWorldPosition(store, currentViewPath, newCellPos);
    } else if (nextEntry.transition === 'exit') {
      // Object is exiting to parent, calculate position in current view
      // (which now shows the parent grid)
      newWorldPos = getCellWorldPosition(store, currentViewPath, newCellPos);
    } else {
      // Normal case: use current view for new position
      newWorldPos = getCellWorldPosition(store, currentViewPath, newCellPos);
    }

    if (!oldWorldPos || !newWorldPos) {
      console.log(`  Skipping animation for ${cellId}: could not calculate world positions`);
      continue;
    }

    movements.push({
      cellId,
      oldPos: [oldWorldPos.x, oldWorldPos.y, oldWorldPos.z],
      newPos: [newWorldPos.x, newWorldPos.y, newWorldPos.z]
    });
  }

  return movements;
}
```

### Step 3: Update attemptPush() Flow

Modify the push handling to pass view paths and enable enter/exit animations:

```typescript
private attemptPush(direction: Direction): void {
  // ... existing code ...

  // Store OLD view path before grid transition
  const oldViewPath = this.currentViewPath;

  // ... push operation ...

  if (changedGrids) {
    // Grid transition - update view using camera controller
    const transition = this.detectGridTransition(pushChain, playerPos.gridId, newPos.gridId);

    let viewUpdate;
    if (transition?.type === 'enter') {
      // Get viaNonPrimaryReference flag from chain entry metadata
      const viaNonPrimaryReference = pushChain[1].viaNonPrimaryReference ?? false;
      viewUpdate = this.cameraController.onPlayerEnter(playerPos.gridId, newPos.gridId, viaNonPrimaryReference);
    } else if (transition?.type === 'exit') {
      viewUpdate = this.cameraController.onPlayerExit(playerPos.gridId, newPos.gridId);
    } else {
      viewUpdate = this.cameraController.onPlayerMove(newPos.gridId);
    }

    // Update current view
    const newViewPath = viewUpdate.targetView;
    this.currentViewPath = newViewPath;

    // NEW: Convert push chain to movements using BOTH view paths
    const movements = this.chainToMovements(
      pushChain,
      oldViewPath!,      // Previous view
      newViewPath        // Current view
    );

    // Create combined animation: camera + object movements
    if (movements.length > 0 && viewUpdate.animationStartView) {
      this.createEnterExitAnimation(
        movements,
        viewUpdate.animationStartView,
        viewUpdate.targetView
      );
    } else {
      // Fallback to instant transition
      this.currentScene = null;
      this.render(true);
    }
  }
}
```

### Step 4: Create Combined Animation Function

Add a new function to handle simultaneous camera and object animations:

```typescript
/**
 * Create animation for enter/exit transitions.
 * Animates both the camera (zoom) and objects (position) simultaneously.
 */
private createEnterExitAnimation(
  movements: Array<{
    cellId: string;
    oldPos: [number, number, number];
    newPos: [number, number, number];
  }>,
  startViewPath: ViewPath,
  endViewPath: ViewPath
): void {
  const duration = CAMERA_ANIMATION_DURATION; // Reuse camera duration (0.3s)

  // Stop any existing animations
  this.animationSystem.stop();
  this.cameraAnimationSystem.stop();

  // Build scene at END view (target)
  this.currentScene = null;
  this.rebuildSceneData(); // Rebuilds with currentViewPath = endViewPath

  // 1. Create camera animation (existing logic from animateCameraTransition)
  const startCameraParams = this.calculateCameraForView(startViewPath);
  const endCameraParams = this.calculateCameraForView(endViewPath);

  const cameraClip: CameraAnimationClip = {
    id: 'camera-transition',
    duration,
    loop: false,
    channels: [/* camera center and rightEdge keyframes */]
  };

  // 2. Create object animations
  // Objects are rendered at their NEW positions in the scene
  // We animate FROM their old positions (using world-space offsets)
  const animations: Array<AnimationData> = [];

  for (const movement of movements) {
    // Calculate offset from new position to old position
    const relativeOffset: [number, number, number] = [
      movement.oldPos[0] - movement.newPos[0],
      movement.oldPos[1] - movement.newPos[1],
      movement.oldPos[2] - movement.newPos[2]
    ];

    animations.push({
      nodeId: movement.cellId,
      channels: [{
        target: 'position',
        interpolation: 'linear',
        keyFrames: [
          { time: 0, value: relativeOffset, easing: Easing.easeInOutQuad },
          { time: duration, value: [0, 0, 0] } // Animate to identity (final position)
        ]
      }]
    });
  }

  const objectClip: AnimationClip = {
    id: 'enter-exit-move',
    duration,
    loop: false,
    animations
  };

  // 3. Add and play both animations
  this.cameraAnimationSystem.addClip(cameraClip);
  this.cameraAnimationSystem.play('camera-transition');

  this.animationSystem.addClip(objectClip);
  this.animationSystem.play('enter-exit-move');

  // 4. Start animation loop
  this.isAnimating = true;
  this.startAnimationLoop();
}
```

### Step 5: Handle Edge Cases

**Problem 1: Multiple objects in chain**
- Solution: The push chain already includes all affected objects
- Each gets its own animation based on its transition type

**Problem 2: Objects entering/exiting different grids**
- Solution: Calculate positions individually per object using the appropriate view paths
- The chain's transition metadata tells us which view to use for each position

**Problem 3: Empty cells**
- Solution: Skip empty cells (already done in current code)
- Only animate Concrete and Ref cells

**Problem 4: Teleportation through secondary refs**
- Solution: If position changes discontinuously (large world-space jump), consider:
  - Skip animation (instant teleport), OR
  - Use a fade-out/fade-in effect instead of position interpolation

## Benefits

1. **Seamless transitions**: Objects smoothly follow the camera zoom
2. **Uses existing infrastructure**: No new animation system needed
3. **Metadata-driven**: Push chain already tells us what to animate
4. **Unified pattern**: Same "previous to current" approach as camera and within-grid animations

## Implementation Order

1. ✅ **Phase 1**: Create `getCellWorldPosition()` helper
2. ✅ **Phase 2**: Update `chainToMovements()` signature to accept view paths
3. ✅ **Phase 3**: Modify `attemptPush()` to capture old view path
4. ✅ **Phase 4**: Implement `createEnterExitAnimation()` function
5. ✅ **Phase 5**: Remove the skip condition at `demo-iso.ts:597-599`
6. ✅ **Phase 6**: Test with various enter/exit scenarios

## Testing Scenarios

1. **Simple exit**: Player pushes object out of inner grid into parent
2. **Simple enter**: Player pushes object from parent into inner grid
3. **Chain with multiple objects**: Objects domino through enter/exit boundary
4. **Rapid input**: Ensure animation cancellation works correctly
5. **Secondary refs**: Verify teleportation is handled gracefully
6. **Nested grids**: Test multi-level hierarchy (grandparent → parent → child)

## Future Enhancements

- **Custom animation metadata** (see `push.ts:34-35`):
  ```typescript
  readonly metadata?: {
    duration?: number;      // Per-object animation duration
    easing?: string;        // Custom easing function
    fadeInOut?: boolean;    // Fade instead of position interpolation
  }
  ```

- **Visual effects**:
  - Scale pulsing when entering/exiting
  - Trail effects during rapid transitions
  - Particle effects at grid boundaries

- **Performance optimizations**:
  - Cull off-screen animations
  - LOD for distant objects
  - Animation pooling for large chains

## References

- Push chain structure: `web/src/lib/operations/push.ts:30-42`
- Scale helper: `web/src/lib/camera/scale-helper.ts:54-139`
- Camera animation: `web/src/demo-iso.ts:977-1089`
- Within-grid animation: `web/src/demo-iso.ts:866-932`
- Chain to movements: `web/src/demo-iso.ts:559-623`
