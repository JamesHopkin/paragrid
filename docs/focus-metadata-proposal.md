# Focus Metadata for Rendering

## Motivation

Enable depth-based visual effects to make recursive structures more readable:

**Depth-based effects:**
- **Haze/blur**: `opacity = 1.0 / (1 + abs(depth) * 0.3)` - descendant grids fade as they recurse
- **Color desaturation**: Deep grids become more grayscale
- **Outline highlighting**: Emphasize depth 0 cells with brighter borders

**Focus-relative effects:**
- **Depth -1 dimming**: Fade the parent grid except near the focus reference
- **Radial fade**: Use `focus_offset` to create distance-based transparency from the focus point
- **Attention ring**: Highlight the immediate neighbors of the focused grid reference

**Game camera integration:**
- As the view path changes (player moves between grids), effects smoothly highlight the current gameplay area
- Could animate depth values during transitions for smooth fade effects
- Gives players a clear sense of "where they are" in the hierarchy

## Problem

Rendering code needs to know for each cell:
- Recursion depth relative to a focused grid
- For depth 0 cells, the offset from the focused grid reference

## Solution

Extend `CellTreeNode` with optional focus metadata:

```typescript
interface CellTreeNode {
    // ... existing fields ...

    focusDepth?: number;  // Relative depth from focused grid
    focusOffset?: [number, number];  // Cell offset from focus ref [x, y]
}
```

## Depth Semantics

- **0**: Cells inside the focused grid
- **-1, -2, ...**: Ancestor grids (parent, grandparent, ...)
- **1, 2, ...**: Descendant grids (children, grandchildren, ...)

## Offset Semantics

- **Depth < 0 (ancestors)**: `[cell_x - ref_x, cell_y - ref_y]` where `[ref_x, ref_y]` is the position of the reference cell that points toward the focused grid
  - For depth -1: offset from the ref to the focused grid's parent
  - For depth -2: offset from the ref to the focused grid's grandparent
  - And so on for all ancestor levels
- **Depth 0**: `[cell_x, cell_y]` within the focused grid
- **Depth > 0 (descendants)**: `undefined` (offsets not provided for descendant grids)

## Implementation

Modify `analyze()` to accept optional focus path:

```typescript
function analyze(
    store: GridStore,
    rootId: string,
    focusPath?: string[],  // e.g., ["A", "B", "C"]
    threshold?: number
): CellTree | null
```

During traversal, compare current path against focus path to compute depth and annotate nodes.

## Integration

Works naturally with game-camera-proposal where views are represented as paths through the grid hierarchy.
