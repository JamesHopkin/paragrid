# Between-Node Animation Proposal for iso-render

## Problem Statement

Currently, Paragrid disables object animations for certain cases because objects need to animate between different nodes in the scene graph hierarchy:

1. **Self-reference enter/exit** (animation-builder.ts:183-190)
2. **Non-primary reference enter/exit** (animation-builder.ts:150-164)

These cases are disabled because the animation system can only animate objects within their scene graph location, not across different nodes.

## Root Cause

### Position Override Limitation

The current approach uses `cellPositionOverrides` to position root grid cells at OLD position before animating to NEW. However:

- **Root grid cells**: Can use position overrides ✓
- **Template instances**: Cannot use position overrides ✗

Template instances are built once and positioned based on the analyzed grid structure. They can't be repositioned via overrides, causing visual glitches where objects:
1. Start at NEW position (wrong)
2. Animate +1 cell
3. Snap back to correct position

This is documented in design.md:170-202.

### Self-Reference Example

When exiting a self-reference, the object moves between different depths of the same grid:

```
Scene graph:
  Root: main[0,1] (where object ends up - final state)
  └─ ref-main at main[0,2]
      └─ template-0 (scaled down copy of main)
          └─ main[0,0] (where object started - animation origin)
```

**Challenge**: The object needs to animate from `template-0's main[0,0]` → `root's main[0,1]`:
- Different scene graph nodes (template instance vs root grid)
- Same grid ID, different hierarchy levels
- Position overrides can't bridge template → root (or root → template)

**Current workaround**: Skip object animation entirely, rely on camera zoom only.

## Proposed Solution: Between-Node Animation

If iso-render provided an animation system extension to animate objects _between_ scene graph nodes, it would work like this:

### API Concept

```typescript
// Build scene in final state - object is attached to its destination node
// No position overrides needed

// Animation specification:
{
  objectId: "concrete-1",           // Which object to animate (existing ID system)
  sourceNode: "template-0/cell-0-0", // Where to visually START
  destNode: "root-cell-0-1",         // Where object LIVES in scene graph
  duration: 0.3,
  easing: "ease-out"
}

// Animation system behavior:
// 1. Initially: Render object at sourceNode's world transform
// 2. Animate: Transition from sourceNode to destNode transform
// 3. Finally: Object naturally appears at destNode (where it's attached)
```

### Current vs Proposed Workflow

**Current approach** (requires overrides):
```typescript
// Build time
cellPositionOverrides.set('concrete-1', oldPosition);  // ❌ Only works for root
// Scene graph has object at OLD position
// Animate: old → new
```

**With between-node animation**:
```typescript
// Build time: no overrides needed
// Scene graph has object at NEW position (final state)
// Animation spec: "concrete-1 animates from nodeA to nodeB"
// Animation system handles the visual transition
```

## Benefits

1. **Uniform behavior**: Works identically for root grid and all template depths
2. **Re-enable disabled animations**:
   - Self-reference enter/exit ✓
   - Non-primary reference transitions ✓
3. **Cleaner build logic**: No position override mechanism needed
4. **Final-state scene graph**: Build the scene in its final state, animation is purely presentation
5. **Template-friendly**: Templates built once in final state, animation spec is separate data
6. **Separation of concerns**: Scene structure (spatial hierarchy) vs animation (temporal transition)

## Technical Considerations

### Transform Calculation

The animation system would need to:
1. Query world transform of source node at animation start
2. Query world transform of destination node at animation start
3. Interpolate between these transforms over time
4. Apply resulting transform to the animated object

### Scene Graph Attachment

The object remains attached to its destination node in the scene graph throughout. The animation system only affects rendering/projection, not the underlying structure.

### Concurrent Animations

Self-reference cases would use this in combination with camera zoom:
- **Camera animation**: Zooms in/out
- **Object animation**: Moves from template depth to root depth (or vice versa)
- **Combined effect**: Object appears to slide and scale naturally as camera perspective changes

## Use Cases in Paragrid

### 1. Self-Reference Exit

```
Object at template-0/main[0,0] needs to move to root/main[0,1]
Camera zooms out while object "grows" and slides into position
```

### 2. Self-Reference Enter

```
Object at root/main[0,1] needs to move to template-0/main[0,0]
Camera zooms in while object "shrinks" and slides into nested position
```

### 3. Non-Primary Reference Teleport

```
Object exits via secondary ref, teleports to primary ref location
Animate from secondary ref node to primary ref node
Provides visual continuity for teleportation
```

### 4. Cross-Template Movements

Any time an object moves from one template instance to another, or from template to root, or root to template.

## Implementation Notes for iso-render

This would be a significant feature addition to iso-render. Key requirements:

1. **Node identification**: Need stable IDs or references for scene graph nodes
2. **World transform query**: Ability to get world-space transform of any node
3. **Animation override**: Mechanism to render an object at a different transform than its scene graph location
4. **Animation lifecycle**: Start, update, complete phases
5. **Cleanup**: Remove animation override when complete, object renders normally at its scene graph location

## Alternative Considered: Multiple Object Instances

Instead of between-node animation, we could:
- Render object at BOTH source and dest nodes
- Fade out source, fade in dest
- Cross-fade between them

**Rejected because**:
- Doesn't provide smooth positional continuity
- Doubles rendering cost
- Doesn't capture the semantic meaning (one object moving)

## Status

**Currently**: Object animations disabled for self-reference and non-primary reference cases (see animation-builder.ts:150-164, 183-190)

**Future work**: This proposal requires upstream changes to iso-render library

## References

- `docs/design.md:170-202` - Current limitation with position overrides and template instances
- `web/src/lib/animations/animation-builder.ts:150-164` - Non-primary reference animation skip
- `web/src/lib/animations/animation-builder.ts:183-190` - Self-reference animation skip
