# Exit Transformation Specification

## Purpose

When rendering a grid in world space, we need to compute the transformation (scale and offset) of the **exit target grid** relative to the **current grid's coordinate system** for any navigable edge.

This allows rendering UI elements (like exit indicators or preview overlays) that show how the current grid relates to the grid you would enter when exiting in a particular direction.

## Context

- **Current Grid**: The grid being rendered, with each cell having width 1.0 in world space
- **World Space**: The coordinate system where the current grid is rendered
- **Exit Target Grid (E)**: The grid that would become the current view if we exit in the specified direction
- **Navigation**: Controlled by the `Navigator` class, which determines if/where an exit is possible

## Inputs

| Parameter | Type | Description |
|-----------|------|-------------|
| `store` | `GridStore` | The complete collection of grids |
| `currentGridId` | `string` | ID of the grid currently being rendered at scale 1.0 |
| `direction` | `Direction` | The edge direction to check (N/S/E/W) |
| `position` | `CellPosition` | The position in current grid from which we're checking exit (typically the edge cell) |

## Outputs

```typescript
interface ExitTransformation {
  targetGridId: string;     // ID of the exit target grid E
  scale: number;            // How much larger E is than current (>1 means E is bigger)
  offsetX: number;          // Horizontal offset of current grid's origin in E's coordinate system
  offsetY: number;          // Vertical offset of current grid's origin in E's coordinate system
}
```

Or `undefined` if no exit is possible in that direction.

### Coordinate System

- **Origin (0, 0)**: Top-left corner of grid
- **X-axis**: Increases rightward (column direction)
- **Y-axis**: Increases downward (row direction)
- **Cell dimensions**: Each cell is 1.0 × 1.0 in current grid's space

## Exit Cases

The `Navigator.tryAdvance()` method determines two types of valid exits:

### Case 1: Exit to Parent Grid

When the current grid is referenced by a parent grid, and we reach an edge that allows exiting:

1. The current grid is inside a **Ref cell** in the parent grid E
2. The Ref cell that contains current grid is the **primary reference** to current
3. The current grid occupies exactly one cell in E
4. That cell may have dimensions different from 1.0 × 1.0 in E's coordinate system

**Calculation**:
- Find the primary reference: `[parentGridId, refRow, refCol]` via `findPrimaryRef(store, currentGridId)`
- The current grid's **entire extent** maps to **one cell** in parent E
- Scale: E is larger by factor equal to `1.0 / (E's cell size)`
  - If current occupies one 1×1 cell in E, then scale = `E.cols` (E is E.cols times wider) and `E.rows` (E is E.rows times taller)
- Offset: Top-left of current grid maps to top-left of the ref cell in E
  - `offsetX = refCol` (in E's coordinate system)
  - `offsetY = refRow` (in E's coordinate system)

**Chain of parents**: If the exit cascades through multiple parent grids (when the exit cell in parent is also out of bounds), continue up the chain until finding a valid exit position. The final parent in the successful chain is E.

### Case 2: Exit via Primary Reference (Teleportation)

When exiting through the **west edge** of a grid that contains the **primary reference** to the current grid:

1. We're at the west edge of a grid G
2. G contains the primary reference to current grid
3. Exiting west from G's edge teleports us to the primary ref location
4. E is grid G (the one containing the primary ref)

**Calculation**:
- Find which grid G contains the primary reference to current: `[G_id, refRow, refCol]`
- Check if we're at G's west edge and can exit west
- E = G (the container of the primary ref)
- Scale and offset: Same as Case 1 (current is contained in one cell of G)

**Note**: This case specifically handles the "teleportation" semantics where secondary references bounce back to the primary reference location.

## Algorithm Outline

```typescript
function computeExitTransformation(
  store: GridStore,
  currentGridId: string,
  direction: Direction,
  position: CellPosition
): ExitTransformation | undefined {

  // 1. Use Navigator to determine if exit is possible
  const nav = new Navigator(store, position, direction);
  const canExit = nav.tryAdvance();

  if (!canExit) {
    return undefined; // No exit possible
  }

  // 2. Navigator now points to exit target grid E
  const targetGridId = nav.current.gridId;
  const exitPosition = nav.current;

  // 3. Find the primary reference to current grid
  const primaryRef = findPrimaryRef(store, currentGridId);

  if (!primaryRef) {
    // Current is root, no parent transformation possible
    return undefined;
  }

  const [parentGridId, refRow, refCol] = primaryRef;
  const parentGrid = store[parentGridId];

  // 4. Compute transformation
  // Current grid's entire extent (currentGrid.cols × currentGrid.rows)
  // maps to one cell (1.0 × 1.0) in parent coordinate system

  const currentGrid = store[currentGridId];

  // If target is direct parent, compute transformation
  if (targetGridId === parentGridId) {
    return {
      targetGridId: parentGridId,
      scale: currentGrid.cols, // Simplified: assuming square or taking one dimension
      // More precisely: scaleX = currentGrid.cols, scaleY = currentGrid.rows
      offsetX: refCol,
      offsetY: refRow
    };
  }

  // If target is further up the chain, need to compose transformations
  // through intermediate grids
  // ... (recursive or iterative composition)

  return result;
}
```

## Transformation Interpretation

The result describes how to transform the current grid's coordinates into E's coordinate system:

```
E_coord = (current_coord + offset) / scale
```

Or inversely, how to transform E's coordinates into current grid's system:

```
current_coord = E_coord * scale - offset
```

**Example**:
- Current grid is 4×4, referenced in E at position (2, 3)
- A point at (0, 0) in current maps to (2, 3) in E
- A point at (4, 0) in current maps to (3, 3) in E (since 4 cells of current = 1 cell of E)
- Scale = 4 (current is 4× smaller than one E cell)
- Offset = (2, 3)

## Edge Cases

1. **Root Grid**: If current grid has no parent, no exit transformation exists
2. **Cascading Exit**: If exiting cascades through multiple parents, the final target E may be several levels up
3. **Self-Reference**: If a grid references itself, cycles may occur (Navigator handles this)
4. **Different Aspect Ratios**: Current grid may be non-square (e.g., 3×5), affecting scale
5. **Teleportation**: Exiting west from grid containing primary ref of current

## Dependencies

- `Navigator` class: Determines if exit is possible and where it leads
- `findPrimaryRef()`: Locates the primary reference to current grid
- Grid dimensions: `Grid.rows` and `Grid.cols`
- Position information: `CellPosition` for tracking locations

## Usage Contexts

1. **Rendering exit indicators**: Show arrows or highlights on edges that allow exit
2. **Preview overlays**: Show a mini-view of the target grid E with current grid's position highlighted
3. **Camera transitions**: Smooth zoom/pan from current view to E's view when exiting
4. **Minimap rendering**: Show hierarchical context of current grid within parent grids
