# Dynamic Origin System for Stable Animation Coordinates

## Problem Statement

### The Animation Depth Visibility Issue

When animating through deep hierarchies (e.g., from depth 2 to depth 10), we face a visibility problem:

- Current system truncates view paths to show ~3 levels (`slice(-3)`)
- During animation, if depth changes too much, we either:
  - Show shallow levels (player disappears as they go deep)
  - Show deep levels (context/ancestors missing)
- Need to smoothly transition what's visible during animation

**Initial approach considered:** "Bait-and-switch" - rebuild scene halfway through animation when camera is most obscured.

### The Deeper Problem: Coordinate System Jumps

Upon investigation, discovered a more fundamental issue with how coordinates work:

**Current System:**
```typescript
// demo-iso.ts:1180
const gridId = viewPath[0];  // The ROOT of the analyzed tree
analyze(store, gridId, ...);

// isometric.ts:236-238
// Center the grid around the origin
const offsetX = -(cols - 1) / 2;
const offsetZ = -(rows - 1) / 2;
```

**The Problem:**
- `viewPath[0]` is always centered at world origin `(0, 0, 0)`
- Changing viewPath changes which grid is at origin
- Example:
  - `viewPath = ['main', 'inner']` → 'main' at origin
  - `viewPath = ['inner', 'deep']` → **'inner' at origin** (coordinate jump!)
- Any animation that changes viewPath[0] causes objects to jump in world space

## Key Insight: View-Relative Coordinate System

The concept of "root" is slippery in paragrid:
- Multiple hierarchies you can teleport between
- Self-reference cycles: player can exit through self-reference repeatedly
  - Logically getting "further from origin"
  - But visually staying in same place
  - Should the coordinate system reflect this equivalence?

**Proposed Solution:**
- Maintain a **stable origin** independent of view path
- Origin is "dynamic" from app's perspective (defined relative to visible content)
- But maintains consistent world coordinates across view changes
- "Keep animations running in world space and just add/remove levels"

## Proposed Design

### Conceptual Model

Maintain an unlimited conceptual list of grids extending from some anchor point (the "origin"). The view path shows a window into this list, and we need to track where that window is positioned relative to the origin.

### Separation of Concerns

1. **Camera implementations** specify relationships between views (enter/exit/jump)
2. **Camera system** (demo-iso.ts) maintains origin state
3. **Renderer** receives offset information to position viewPath[0] correctly

Camera implementations should NOT have to maintain origin state themselves.

### Protocol Change

**camera-protocol.ts:**
```typescript
export interface ViewUpdate {
  readonly targetView: ViewPath;
  readonly animationStartView?: ViewPath;
  readonly trackObjectAnimations?: boolean;

  // NEW: How does targetView relate to the current view?
  readonly viewRelationship?: {
    type: 'extends' | 'prefix';
    // 'extends': targetView extends current view (enter deeper)
    //            e.g., ['main', 'inner'] → ['main', 'inner', 'deep']
    // 'prefix': targetView is prefix of current view (exit up)
    //           e.g., ['main', 'inner', 'deep'] → ['main', 'inner']
    // If undefined: jump to new hierarchy, reset origin
  };
}
```

### Camera System Maintains Origin

**demo-iso.ts:**
```typescript
class IsometricDemo {
  private currentViewPath: ViewPath;

  // NEW: Origin tracking
  private originAnchorGrid: string;   // Which grid is at world (0,0,0)
  private originAnchorPath: ViewPath; // Full path to origin grid

  handleViewUpdate(viewUpdate: ViewUpdate) {
    const oldViewPath = this.currentViewPath;
    const newViewPath = viewUpdate.targetView;

    // Determine if origin should stay fixed
    if (viewUpdate.viewRelationship) {
      // Relationship specified - keep same origin anchor
      // originAnchorPath stays unchanged
    } else {
      // No relationship - jump to new hierarchy, reset origin
      this.originAnchorPath = [newViewPath[0]];
    }

    this.currentViewPath = newViewPath;

    // Calculate offset from origin to viewPath[0] for rendering
    const offset = this.calculateOffsetFromOrigin();
    this.render(offset);
  }

  private calculateOffsetFromOrigin(): [number, number, number] {
    // TODO: Traverse from originAnchorPath to currentViewPath[0]
    // and accumulate position transforms
  }
}
```

### Camera Implementations Specify Relationships

**animated-parent-view-camera.ts:**
```typescript
onPlayerEnter(fromGridId: string, toGridId: string): ViewUpdate {
  const fromViewPath = buildViewPath(this.helper, fromGridId);
  const toViewPath = buildViewPath(this.helper, toGridId);

  return {
    targetView: toViewPath,
    animationStartView: fromViewPath,
    viewRelationship: { type: 'extends' }  // NEW!
  };
}

onPlayerExit(fromGridId: string, toGridId: string): ViewUpdate {
  const fromViewPath = buildViewPath(this.helper, fromGridId);
  const toViewPath = buildViewPath(this.helper, toGridId);

  return {
    targetView: toViewPath,
    animationStartView: fromViewPath,
    viewRelationship: { type: 'prefix' }  // NEW!
  };
}
```

### Analyze Receives Location Information

```typescript
analyze(
  store: GridStore,
  gridId: string,  // viewPath[0] - the grid to analyze from
  width: number,
  height: number,
  threshold: number,
  primaryRefs: Set<string>,
  focusPath: ViewPath,
  originOffset: [number, number, number]  // NEW: position of this grid relative to origin
): CellNode
```

Quote from discussion: "analyze just needs to be told the location of the first grid in the view path."

## Example Scenarios

### Shallow Navigation
```typescript
viewPath = ['main', 'inner']
originPath = ['main']
// 'main' at (0,0,0), 'inner' positioned relative to its ref cell in 'main'
```

### Deep Navigation (Same Origin)
```typescript
viewPath = ['main', 'inner', 'deep', 'deeper']
originPath = ['main']  // Still anchored at 'main'!
// All grids positioned relative to 'main', no coordinate jump
```

### Self-Reference Cycle
```typescript
viewPath = ['main', 'main', 'main']  // Exited 2 times through self-ref
originPath = ['main']  // First 'main' is origin
// The 2nd and 3rd 'main' instances positioned relative to their parent refs
```

### Animation Through Deep Hierarchy
- **Start**: `viewPath = ['main', 'inner']`, `originPath = ['main']`
- **End**: `viewPath = ['main', 'inner', 'deep', 'deeper']`, `originPath = ['main']`
- Origin stays fixed at 'main'
- Analyze once from 'main', show different depth windows
- Camera smoothly zooms/pans in world space
- No coordinate jump!

## Open Questions

### 1. Calculating originOffset
How to calculate the offset from `originAnchorPath` to `viewPath[0]`?
- Need to traverse the path and accumulate position transforms
- How do we get cell positions at each level?
- Does this require a full analysis pass, or can we use grid dimensions only?

### 2. Where to Apply the Offset
Should the offset be:
- Passed to `analyze()` to bake into the tree?
- Passed to `buildIsometricScene()` as a transform?
- Applied during rendering via camera position?
- Some combination?

### 3. Self-Reference Path Disambiguation
If `viewPath = ['main', 'main']`, how do we distinguish which 'main' instance?
- Maybe viewPath needs instance indices: `['main#0', 'main#1']`?
- Or is the sequential order in the array sufficient?
- How does this interact with the `GridStore` which only knows grid IDs?

### 4. Threshold and Deep Analysis
The analyzer has a `threshold` parameter that stops recursion when cells get too small. If we always analyze from a fixed origin:
- Might not reach deep descendants due to threshold cutoff
- Options:
  - Disable/increase threshold to ensure we reach deep descendants?
  - Use a different cutoff mechanism (max depth instead of size threshold)?
  - Analyze a "window" around the animated path?
  - Accept some cutoff and handle gracefully?

### 5. FocusPath and Visibility
The `focusPath` parameter already exists in `analyze()` and computes `focusDepth` metadata:
- `focusDepth = 0`: The focused grid itself
- `focusDepth < 0`: Ancestor grids (parent, grandparent, etc.)
- `focusDepth > 0`: Descendant grids (children in the tree)

Currently only used for layering (isometric.ts:63). Should we:
- Use `focusDepth` to cull geometry (don't render if too far from focus)?
- Use it to control opacity/visibility during animations?
- Add a "visible depth range" parameter to rendering?

### 6. Multiple Hierarchy Roots
How do we handle transitions between disconnected hierarchies (via teleportation)?
- When `viewRelationship` is undefined (jump), reset origin
- But what if user wants to maintain spatial relationship between hierarchies?
- Need a registry of hierarchy positions?

### 7. Performance
If we analyze from a stable origin and build large scenes:
- Re-analyzing less frequently (good!)
- But larger scene graphs to maintain (potentially bad?)
- Need to profile with realistic deep hierarchies

## Implementation Strategy

### Phase 1: Protocol & State
1. Add `viewRelationship` to `ViewUpdate` interface
2. Add origin tracking fields to demo-iso.ts
3. Update camera implementations to specify relationships
4. Wire through but don't use yet (keep existing behavior)

### Phase 2: Origin Calculation
1. Implement `calculateOffsetFromOrigin()` function
2. Test with simple cases (no self-references)
3. Handle self-reference cases

### Phase 3: Integration
1. Pass offset to analyze/render pipeline
2. Update coordinate calculations in buildIsometricScene
3. Test that animations maintain stable coordinates

### Phase 4: Depth Visibility
1. Add depth-based culling/visibility controls
2. Implement smooth showing/hiding of levels during animation
3. Test with deep hierarchy animations

## Related Files

- `/web/src/lib/camera/camera-protocol.ts` - Camera controller interface
- `/web/src/lib/camera/animated-parent-view-camera.ts` - Animated camera impl
- `/web/src/lib/camera/parent-view-camera.ts` - Base camera, buildViewPath()
- `/web/src/demo-iso.ts` - Main demo, handles ViewUpdates, maintains state
- `/web/src/lib/analyzer/analyze.ts` - Tree building with dimensional tracking
- `/web/src/lib/renderer/isometric.ts` - Scene building, grid positioning
- `/web/src/lib/camera/scale-helper.ts` - Coordinate calculations

## Notes

- This is a significant architectural change to coordinate system handling
- Requires careful testing with cycles, teleportation, and deep nesting
- May want to prototype in a branch before committing to full implementation
- Consider backward compatibility - can we feature-flag the new system?
