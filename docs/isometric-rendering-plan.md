# Isometric Rendering Implementation Plan

## Overview
Implement isometric visualization for paragrid web using the iso-render library. The implementation will:
- Port the Python analyzer to TypeScript (without rational arithmetic, using `number` only)
- Build isometric renderer that maps grid hierarchy to 3D scenes
- Use flat Y=0 layout with checkered floors and floating solids
- Leverage iso-render's reference system for paragrid's Ref cells

## Design Decisions

### 3D Spatial Layout
- **Flat grid**: All cells at Y=0 (ground plane)
- **No depth stacking**: Nested grids render within their parent cells (subdivided)
- **Use iso-render references**: Map paragrid Ref cells to iso-render's group reference system

### Visual Style
- **Grid floors**: Subtle checkerboard pattern for each (sub-)grid
- **Concrete objects**: Simple solid cubes floating above cells (at Y=0.5 for example)
- **Empty cells**: Transparent or very subtle floor marking
- **Refs**: Minimal visual distinction from content (rely on iso-render references)

### Technical Approach
- **Port analyzer**: Translate Python `analyze()` to TypeScript, replace `Fraction` with `number`
- **Skip rational arithmetic**: Use floating point throughout (accept minor rounding)
- **CellTree types**: Port EmptyNode, ConcreteNode, RefNode, NestedNode, CutoffNode

## Files to Create

### 1. `web/src/lib/analyzer/types.ts`
Port Python CellTree types:
```typescript
export type CellNode = EmptyNode | CutoffNode | ConcreteNode | RefNode | NestedNode;

export interface EmptyNode {
  type: 'empty';
}

export interface CutoffNode {
  type: 'cutoff';
  gridId: string;
}

export interface ConcreteNode {
  type: 'concrete';
  id: string;
  gridId: string;
}

export interface RefNode {
  type: 'ref';
  gridId: string;
  refTarget: string;
  isPrimary: boolean;
  content: CellNode;
}

export interface NestedNode {
  type: 'nested';
  gridId: string;
  children: ReadonlyArray<ReadonlyArray<CellNode>>;
}
```

### 2. `web/src/lib/analyzer/analyze.ts`
Port Python `analyze()` function:
- DFS traversal building CellTree
- Track visited grids (cycle detection)
- Track primary references
- Dimensional tracking with `number` (not Fraction)
- Threshold-based cutoff (default 1/10)

Key differences from Python:
- Use `number` instead of `Fraction` for dimensions
- Floating point arithmetic instead of rational
- TypeScript immutability patterns

### 3. `web/src/lib/renderer/isometric.ts`
Main isometric renderer using iso-render:

**Core function**: `renderIsometric(node: CellNode, options: RenderOptions): void`

**Key responsibilities**:
1. Build iso-render scene from CellTree
2. Create SceneBuilder and recursively walk tree
3. For NestedNode: create group, add checkerboard floor, recurse for children
4. For ConcreteNode: add floating cube (use `cube(size)` primitive)
5. For RefNode: use iso-render's `reference()` feature to reuse geometry
6. For EmptyNode/CutoffNode: skip or add subtle floor marker

**Scene building strategy**:
- First pass: build all grid geometries as groups
- Second pass: instantiate at positions
- Use `SceneBuilder.group()` for each grid
- Use `SceneBuilder.reference()` for Ref cells

**Coordinate mapping**:
- Cell at (row, col) in NxM grid → position [col, 0, row] in 3D
- Cell size: 1.0 units (scale down if needed)
- Concrete objects: position [col, 0.5, row] (elevated above floor)

### 4. `web/src/lib/renderer/colors.ts`
Color utilities:
- `getGridColor(gridId: string): string` - deterministic color from grid ID
- Hash-based color generation (similar to Python's colorizer)
- Distinct colors for different grids

### 5. `web/src/main.ts` (update)
Integration with HTML:
- Parse example grid definitions
- Run analyzer to get CellTree
- Render isometric view to `#app` div
- Setup camera (Camera.trueIsometric())
- Create Renderer with SVG backend

## Implementation Steps

### Phase 1: Analyzer Port
1. Create `web/src/lib/analyzer/types.ts` with CellNode types
2. Create `web/src/lib/analyzer/analyze.ts` with core analysis logic
3. Port dimensional tracking (using `number`)
4. Port cycle detection and primary reference tracking
5. Add tests (port key Python test cases)

### Phase 2: Renderer Foundation
1. Install iso-render: `npm install iso-render`
2. Create `web/src/lib/renderer/colors.ts` with color utilities
3. Create `web/src/lib/renderer/isometric.ts` skeleton
4. Implement basic scene building (flat grid, no refs yet)
5. Test rendering simple grid with concrete cells

### Phase 3: Advanced Features
1. Implement checkerboard floor generation
2. Add floating cube rendering for ConcreteNodes
3. Implement reference system for RefNodes
4. Handle nested grids (recursive group building)
5. Handle CutoffNodes and EmptyNodes

### Phase 4: Integration
1. Update `web/src/main.ts` with full pipeline
2. Add example grid definitions (from Python tests)
3. Wire up camera controls (if desired)
4. Test with complex examples (cycles, deep nesting)

## Critical Files to Reference

### From Python Implementation
- `python/paragrid.py:234-346` - CellTree types and analyze() function
- `python/paragrid.py:283-346` - analyze() implementation details
- `python/ascii_render.py:126-247` - render_to_buffer() traversal pattern

### From TypeScript Implementation
- `web/src/lib/core/types.ts` - Grid, Cell, GridStore types (already implemented)
- `web/src/lib/parser/parser.ts` - parseGrids() function (already implemented)

### From iso-render API
- Scene building: SceneBuilder, objects, instances, groups
- References: `builder.reference(groupId, {translation, scale})`
- Primitives: `cube(size)`, `rectangle(width, height)`
- Projection: `project(scene, camera, width, height)`
- Rendering: `new Renderer({target, backend, width, height})`

## Key Technical Challenges

### 1. Reference Semantics
Paragrid has primary/secondary refs with teleportation. iso-render has references with transforms.
- **Solution**: Build each grid as a group once, use `reference()` to instantiate at positions
- Primary refs: rendered in place (no special handling in scene)
- Secondary refs: use same reference mechanism (teleportation is navigation logic, not rendering)

### 2. Coordinate Mapping
Grid cells need to map to 3D positions consistently.
- **Solution**: Cell (row, col) → [col, 0, row], grid origin at [0, 0, 0]
- Nested grids: subdivide parent cell's space (compute sub-cell positions)

### 3. Nested Grid Sizing
Parent cell dimensions determine child grid dimensions.
- **Solution**: Track cell width/height during traversal, pass to children
- Use equal subdivision (width/cols, height/rows)

### 4. Checkerboard Floor Pattern
Need to generate checkerboard geometry efficiently.
- **Solution**: Create alternating rectangles or use solid+texture (if iso-render supports)
- Alternative: single rectangle with alternating cell colors

## Testing Strategy
- Port key Python analyzer tests to TypeScript (vitest)
- Visual inspection with example grids
- Test cycle handling, deep nesting, multiple refs
- Compare with Python ASCII output (structural equivalence)

## Success Criteria
- ✅ Analyzer produces CellTree equivalent to Python version (structurally)
- ✅ Simple grid (no refs) renders with checkerboard floor and floating cubes
- ✅ Nested grids render correctly (subdivided cells)
- ✅ Ref cells use iso-render references (reused geometry)
- ✅ Camera controls work (pan, zoom via iso-render Camera)
- ✅ Example grids from Python tests render correctly
