# Isometric Reference Rendering Design

## Overview

This document describes the architecture for rendering paragrid **Ref cells** (grid references) in the isometric renderer. The design follows the proven two-phase approach from the Python implementation: **analyze** (build a tree structure) → **render** (traverse tree to build scene).

**Key insight**: Cycle handling happens naturally through dimensional thresholds — when subdivisions become too small, we stop recursing. No explicit cycle detection needed.

## Reference Implementation

The Python implementation (`python/paragrid.py`) provides the reference architecture:
- `analyze()` function (lines 283-346): DFS traversal with dimensional tracking
- `CellNode` types (lines 235-275): Tree structure representing analyzed grid
- Threshold-based termination: stops when dimensions < 1/10 (configurable)
- Primary reference tracking: first ref to each grid becomes primary

## Core Concepts

### Two-Phase Rendering

**Phase 1: Analyze**
- Input: `GridStore`, root `grid_id`, initial dimensions (width, height)
- Output: `CellTree` — recursive tree of `CellNode` variants
- Process: DFS traversal, subdividing dimensions for nested grids
- Termination: When cell dimensions fall below threshold

**Phase 2: Render (Isometric)**
- Input: `CellTree` from analyze phase
- Output: iso-render `Scene` with groups and references
- Process: Walk tree, build scene hierarchy with `SceneBuilder`
- Key: Use iso-render's `Reference` nodes for `RefNode` instances
- **Critical**: ALWAYS use ts-poly's reference system, NEVER manually duplicate geometry

### Cycle Handling

**No explicit cycle detection**. Instead:
1. Track dimensions as we recurse (width, height)
2. Each referenced grid inherits parent cell dimensions
3. Grid subdivides: `cell_width = width / grid.cols`, `cell_height = height / grid.rows`
4. When dimensions < threshold (e.g., 0.1 units): emit `CutoffNode`, stop recursing
5. Cycles naturally terminate when subdivisions become too small

**Example cycle**:
```
Grid A (2×1): [Ref(B), concrete_1]
Grid B (1×2): [Ref(A), concrete_2]
```

Traversal with initial width=1, height=1, threshold=0.1:
- A starts at 1×1
- A[0,0] references B → B inherits 0.5×1 (cell dimensions)
- B[0,0] references A → A inherits 0.5×0.5
- A[0,0] references B → B inherits 0.25×0.5
- A[0,0] references B → B inherits 0.125×0.5
- Continue until width < 0.1 → CutoffNode

### Primary References

Each referenced grid has exactly one **primary reference**. All other refs to the same grid are **secondary**.

**Purpose**: Determines which ref is the "authoritative" instance for rendering. Secondary refs can point to the same geometry.

**Selection logic** (matches Python):
1. If `Ref.isPrimary === true`: explicitly primary
2. If `Ref.isPrimary === false`: explicitly secondary
3. If `Ref.isPrimary === null`: auto-determine
   - First ref to `grid_id` encountered (DFS order) becomes primary
   - Track in `primary_refs: Set<string>` during traversal

**Rendering implication**: With iso-render, we build each grid's geometry once as a `Group`, then use `Reference` nodes to instantiate. Primary/secondary distinction matters for navigation (not covered here), but for rendering all refs can use the same reference mechanism.

## TypeScript Implementation

### Data Types

**File: `web/src/lib/analyzer/types.ts`**

```typescript
/**
 * Cell tree node types - result of analyze phase
 */
export type CellNode = EmptyNode | CutoffNode | ConcreteNode | RefNode | NestedNode;

export interface EmptyNode {
  readonly type: 'empty';
}

export interface CutoffNode {
  readonly type: 'cutoff';
  readonly gridId: string; // Which grid this cutoff belongs to
}

export interface ConcreteNode {
  readonly type: 'concrete';
  readonly id: string;
  readonly gridId: string;
}

export interface RefNode {
  readonly type: 'ref';
  readonly gridId: string;      // Grid this ref cell belongs to
  readonly refTarget: string;   // Grid being referenced
  readonly isPrimary: boolean;  // Whether this is the primary reference
  readonly content: CellNode;   // Analyzed content of referenced grid
}

export interface NestedNode {
  readonly type: 'nested';
  readonly gridId: string;
  readonly children: ReadonlyArray<ReadonlyArray<CellNode>>;
}
```

### Analyze Function

**File: `web/src/lib/analyzer/analyze.ts`**

```typescript
/**
 * Analyze a grid recursively, building a CellTree with dimensional tracking.
 * Terminates when cell dimensions fall below threshold.
 *
 * @param store - Grid store containing all grids
 * @param gridId - Grid to analyze
 * @param width - Width allocated for this grid (in arbitrary units)
 * @param height - Height allocated for this grid (in arbitrary units)
 * @param threshold - Minimum dimension before cutoff (default 0.1)
 * @param primaryRefs - Set tracking which grids have been referenced (for primary detection)
 * @returns CellNode tree representing the analyzed grid
 */
export function analyze(
  store: GridStore,
  gridId: string,
  width: number,
  height: number,
  threshold: number = 0.1,
  primaryRefs: Set<string> = new Set()
): CellNode {
  // Threshold check - terminate if too small
  if (width < threshold || height < threshold) {
    return { type: 'cutoff', gridId };
  }

  const grid = getGrid(store, gridId);
  if (!grid) {
    throw new Error(`Grid not found: ${gridId}`);
  }

  // Subdivide dimensions for cells
  const cellWidth = width / grid.cols;
  const cellHeight = height / grid.rows;

  // Analyze each cell
  const rows: CellNode[][] = [];
  for (let row = 0; row < grid.rows; row++) {
    const cols: CellNode[] = [];
    for (let col = 0; col < grid.cols; col++) {
      const cell = grid.cells[row][col];

      if (isEmpty(cell)) {
        cols.push({ type: 'empty' });
      } else if (isConcrete(cell)) {
        cols.push({ type: 'concrete', id: cell.id, gridId });
      } else if (isRef(cell)) {
        // Determine if this is the primary reference
        let isPrimary: boolean;
        if (cell.isPrimary === true) {
          // Explicitly marked as primary
          isPrimary = true;
          primaryRefs.add(cell.gridId);
        } else if (cell.isPrimary === false) {
          // Explicitly marked as secondary
          isPrimary = false;
        } else {
          // Auto-determine: first ref to this grid is primary
          isPrimary = !primaryRefs.has(cell.gridId);
          if (isPrimary) {
            primaryRefs.add(cell.gridId);
          }
        }

        // Recursively analyze the referenced grid
        const content = analyze(
          store,
          cell.gridId,
          cellWidth,
          cellHeight,
          threshold,
          primaryRefs
        );

        cols.push({
          type: 'ref',
          gridId,
          refTarget: cell.gridId,
          isPrimary,
          content
        });
      }
    }
    rows.push(cols);
  }

  return { type: 'nested', gridId, children: rows };
}
```

### Key Algorithm Details

**Dimensional tracking**:
- Start with root grid at initial dimensions (e.g., 1×1)
- Each cell inherits a fraction of parent: `cell_width = parent_width / cols`
- Referenced grids inherit their parent cell's dimensions
- Numbers shrink with each nesting level
- Threshold stops recursion when too small

**Primary reference selection** (DFS order):
1. Parse grids into store (dictionary iteration order matters)
2. Start at root grid
3. Traverse row-major (top-to-bottom, left-to-right)
4. First `Ref(G)` encountered → primary for grid G
5. Subsequent `Ref(G)` → secondary

**Example**:
```
Grid Main (2×2):
  [Ref(Sub), Concrete(A)]
  [Ref(Sub), Concrete(B)]
```
- Main[0,0] = Ref(Sub) → PRIMARY (first encounter)
- Main[1,0] = Ref(Sub) → secondary

### Isometric Rendering

**File: `web/src/lib/renderer/isometric.ts`** (updated)

The existing `renderGridIsometric` function will be refactored to:

1. **Accept `CellNode` instead of `Grid`**:
   ```typescript
   export function renderIsometric(
     root: CellNode,
     options: RenderOptions
   ): RenderResult
   ```

2. **Recursively traverse the tree**:
   - `NestedNode` → create group, add floor, recurse for children
   - `ConcreteNode` → add cube at position
   - `RefNode` → use iso-render `Reference` to reuse geometry
   - `EmptyNode` → skip or subtle floor
   - `CutoffNode` → render as special marker or skip

3. **Use ts-poly References** (CRITICAL - NEVER DUPLICATE):
   ```typescript
   // Strategy: Build geometry for each unique grid ONCE, then use references everywhere

   // First pass: collect all unique grids from the tree
   function collectUniqueGrids(node: CellNode, grids: Set<string>): void {
     if (node.type === 'nested') {
       grids.add(node.gridId);
       for (const row of node.children) {
         for (const child of row) {
           collectUniqueGrids(child, grids);
         }
       }
     } else if (node.type === 'ref') {
       collectUniqueGrids(node.content, grids);
     }
   }

   // Second pass: build geometry once per unique grid
   const geometryGroups = new Map<string, NodeId>();

   function buildGridGeometry(node: CellNode, builder: SceneBuilder): void {
     if (node.type !== 'nested') return;

     if (geometryGroups.has(node.gridId)) {
       return; // Already built
     }

     const groupId = `grid-geom-${node.gridId}`;
     builder.group(groupId, { position: [0, 0, 0] });

     // Add floor and contents for this grid...
     for (let row = 0; row < node.children.length; row++) {
       for (let col = 0; col < node.children[row].length; col++) {
         const child = node.children[row][col];
         // Render child at relative position within this grid
         // For nested Refs, DON'T recurse - just mark position
       }
     }

     builder.endGroup();
     geometryGroups.set(node.gridId, groupId);
   }

   // Third pass: instantiate using references
   function instantiateNode(node: CellNode, x: number, z: number, width: number, height: number) {
     if (node.type === 'ref') {
       // CRITICAL: ALWAYS use ts-poly reference, NEVER duplicate
       const targetGroup = geometryGroups.get(node.refTarget);
       if (!targetGroup) {
         throw new Error(`Geometry not built for grid: ${node.refTarget}`);
       }

       builder.reference(targetGroup, {
         translation: [x, 0, z],
         scale: [width, 1, height]
       });
     } else if (node.type === 'nested') {
       // Instantiate this grid's geometry
       const groupId = geometryGroups.get(node.gridId);
       if (!groupId) {
         throw new Error(`Geometry not built for grid: ${node.gridId}`);
       }

       builder.reference(groupId, {
         translation: [x, 0, z],
         scale: [width, 1, height]
       });
     }
     // ... handle other node types
   }
   ```

   **Key principle**: Each grid's geometry is built EXACTLY ONCE. All instances use ts-poly's `Reference` system. If references don't work correctly, we fix ts-poly or our usage of it, we do NOT work around it by duplicating geometry.

**Coordinate system**:
- Cell at (row, col) → 3D position [col, 0, row]
- Nested grid at (row, col) inherits parent cell's position + dimensions
- Cell dimensions determine scale for nested content

**Visual styling**:
- Checkerboard floor for each grid (alternating colors)
- Concrete cells as floating cubes (Y=0.3)
- Empty cells transparent
- CutoffNodes could show a subtle marker or be invisible

## Integration Architecture

### Call Flow

```typescript
// 1. Parse grids from definitions
const store = parseGrids(definitions);

// 2. Analyze to build CellTree
const cellTree = analyze(store, 'main', 1.0, 1.0);

// 3. Render isometric scene
const result = renderIsometric(cellTree, {
  width: 800,
  height: 600,
  target: canvasElement,
  highlightPosition: playerPos
});

// 4. Scene is now rendered to DOM via iso-render
```

### Files Modified

1. **`web/src/lib/analyzer/types.ts`** (new) - CellNode types
2. **`web/src/lib/analyzer/analyze.ts`** (new) - analyze function
3. **`web/src/lib/renderer/isometric.ts`** (refactor) - accept CellNode, use references
4. **`web/src/demo-iso.ts`** (update) - call analyze before render

### Backward Compatibility

To maintain existing functionality during transition:

**Option 1: Wrapper function**
```typescript
export function renderGridIsometric(
  grid: Grid,
  options: RenderOptions
): RenderResult {
  // Create simple store with just this grid
  const store = { [grid.id]: grid };
  // Analyze
  const cellTree = analyze(store, grid.id, grid.cols, grid.rows);
  // Render using new function
  return renderIsometric(cellTree, options);
}
```

**Option 2: Dual API**
Keep `renderGridIsometric` for simple grids, add `renderIsometric` for full CellTree support.

## Implementation Plan

### Phase 1: Core Types and Analyze ✅ COMPLETED
1. ✅ Create `web/src/lib/analyzer/types.ts`
2. ✅ Create `web/src/lib/analyzer/analyze.ts`
3. ✅ Port dimensional tracking logic
4. ✅ Port primary reference tracking
5. ✅ Add basic tests (7/7 passing)

**Status**: Analyzer fully implemented and tested. Handles simple grids, references, cycles (self-referencing, mutual references), primary/secondary selection, and threshold cutoff.

**Commit**: `d98f212` - Implement grid analyzer with CellTree generation

### Phase 2: Renderer Refactor ✅ COMPLETED
1. ✅ Create `web/src/lib/renderer/isometric.ts` with new signature accepting `CellNode`
2. ✅ Implement tree traversal for `NestedNode` (recursive rendering)
3. ✅ Handle `ConcreteNode` (floating cubes)
4. ✅ Handle `EmptyNode` (floor only, no content)
5. ✅ Handle `CutoffNode` (skip rendering for now)
6. ✅ Update `demo-iso.ts` to use analyze → render pipeline
7. ✅ Restore debug markers for back edge visualization

**Status**: CellTree-based renderer working. Two-phase pipeline (analyze → render) integrated into demo. Build passes. Ready for visual testing and Phase 3.

**Commits**:
- `dbf1247` - Implement CellTree-based isometric renderer (Phase 2)
- `80a9bac` - Add back debug markers for back edge visualization

### Phase 3: Reference Support ✅ COMPLETED
1. ✅ Collect unique grids from CellTree
2. ✅ Build geometry once per unique grid (Map<gridId, NodeId>)
3. ✅ Use ts-poly's `Reference` nodes for `RefNode` instances
4. ✅ Handle coordinate transforms (position + scale)
5. ✅ Test with simple ref example (non-cyclic)
6. ✅ Test with self-referencing cycle

**Status**: Reference rendering fully implemented and tested. The three-pass approach works:
- **Pass 1**: Collect all unique grids from the CellTree
- **Pass 2**: Build geometry once per unique grid at origin
- **Pass 3**: Instantiate grids using ts-poly's Reference system with translation/scale transforms

**Key Implementation Details**:
- Each grid's geometry is built exactly once in `buildGridGeometry()`
- All instances (including cyclic self-references) use ts-poly's `Reference` nodes
- Scaling calculated as `1 / (refCols or refRows)` to fit nested grid in parent cell
- Centering handled via translation offset
- Cutoff nodes (from threshold) render as nothing, avoiding infinite recursion

**Testing Results**:
- ✅ Simple non-cyclic reference (main → sub) renders correctly
- ✅ Self-referencing cycle (main → main) renders with progressive nesting until cutoff
- ✅ No console errors or warnings
- ✅ Visual output shows proper scaling and nesting

**Commit**: TBD (current changes)

### Phase 4: Cycle Testing (1-2 sessions)
1. ⬜ Test with self-referencing grid (visual verification)
2. ⬜ Test with mutual references (A→B→A)
3. ⬜ Test with deep nesting (>5 levels)
4. ⬜ Verify cutoff behavior (CutoffNode appears as expected)
5. ⬜ Performance testing with many references

### Phase 5: Polish and Documentation (1 session)
1. ⬜ Add example with references to demo
2. ⬜ Test interactive demo with ref-containing grids (WASD navigation)
3. ⬜ Document any ts-poly reference limitations discovered
4. ⬜ Add visual markers for CutoffNode (optional debug mode)

## Testing Strategy

### Unit Tests (vitest)

**Analyzer tests** (`web/src/lib/analyzer/analyze.test.ts`):
- Simple grid (no refs) → NestedNode with ConcreteNodes
- Grid with ref → RefNode with content
- Self-referencing grid → terminates with CutoffNode
- Mutual refs (A→B→A) → terminates with CutoffNode
- Primary selection → first ref is primary

**Visual tests** (manual):
- Render simple 2×2 grid with ref to 1×2 grid
- Render cycle: A→B→A
- Render deep nesting
- Compare visual output with expectations

### Example Test Case

```typescript
describe('analyze', () => {
  it('handles self-reference with cutoff', () => {
    const store = parseGrids({
      main: 'main _'
    });

    const tree = analyze(store, 'main', 1.0, 1.0, 0.1);

    expect(tree.type).toBe('nested');
    if (tree.type === 'nested') {
      const ref = tree.children[0][0];
      expect(ref.type).toBe('ref');
      if (ref.type === 'ref') {
        expect(ref.isPrimary).toBe(true);
        // Should eventually cutoff due to shrinking dimensions
        let node = ref.content;
        let depth = 0;
        while (node.type !== 'cutoff' && depth < 10) {
          expect(node.type).toBe('nested');
          if (node.type === 'nested') {
            node = node.children[0][0];
            if (node.type === 'ref') {
              node = node.content;
            }
          }
          depth++;
        }
        expect(node.type).toBe('cutoff');
      }
    }
  });
});
```

## Edge Cases and Considerations

### 1. Multiple References to Same Grid
- First ref → primary
- Others → secondary
- All use same cached geometry via `Reference`
- Visual appearance identical (primary/secondary only affects navigation)

### 2. Deep Nesting
- Dimensions shrink exponentially: width/cols, height/rows
- Threshold prevents infinite recursion
- Visual: deeper levels render smaller until cutoff

### 3. Aspect Ratio Changes
- Each grid inherits parent cell's aspect ratio
- Grid stretches/squashes to fill cell
- Example: 2×1 grid in 1×2 cell → tall, narrow cells

### 4. Empty Grids
- Grid with all Empty cells → still creates NestedNode
- Floor rendered, no cubes
- Refs to empty grids still participate in geometry

### 5. CutoffNode Visualization
Options:
- Render nothing (most common)
- Small "..." marker or box
- Different color floor tile
- Debug mode: show cutoff depth

### 6. ts-poly Reference Requirements
**To verify experimentally**:
- Can references nest? (Ref → Ref → Ref)
- Transform behavior: translation + scale interaction
- Z-sorting with references
- Performance with many references to the same geometry

**Critical constraint**: We MUST use ts-poly's reference system exclusively. If references don't work as expected:
1. First, verify our usage is correct (check transform ordering, node IDs, etc.)
2. If usage is correct, this indicates a ts-poly bug or limitation that needs fixing
3. We do NOT work around reference issues by duplicating geometry manually

This design choice is intentional - ts-poly's reference system is relatively untested, and paragrid's rendering will stress-test it properly. Any issues found should be fixed in ts-poly.

## Success Criteria

✅ **Analyzer** (Phase 1):
- ✅ Produces CellTree matching Python structure
- ✅ Handles cycles via threshold cutoff
- ✅ Correctly identifies primary references
- ✅ Passes unit tests for common cases (7/7 tests passing)

✅ **Renderer** (Phase 2 & 3):
- ✅ Renders simple grids without refs
- ✅ Tree traversal working (NestedNode → children)
- ✅ ConcreteNode renders as cubes
- ✅ EmptyNode renders floor only
- ✅ CutoffNode skipped (no visual artifact)
- ✅ RefNode rendering (Phase 3 - implemented)
- ✅ Uses ts-poly References exclusively (Phase 3)
- ✅ Maintains visual consistency with simple-iso

🚧 **Integration** (Phase 3-5):
- ✅ Demo uses analyze+render pipeline
- ✅ Demo works with ref-containing grids (simple and cyclic refs tested)
- ⬜ WASD navigation through refs (Phase 4)
- ⬜ Export scene JSON includes reference structure (Phase 4)
- ⬜ Performance acceptable with many refs (Phase 4)

## Open Questions

### Q1: ts-poly Reference Support
**Status**: Needs experimental validation

ts-poly has `Reference` nodes that can reference other groups with translation/scale. Need to verify:
- Do they work with isometric projection?
- How do transforms compose?
- Z-sorting behavior?

**Plan**: Implement Phase 3, test with simple example. If issues arise, debug and fix ts-poly's reference implementation - do NOT work around by duplicating geometry.

**Rationale**: This is a testing opportunity for ts-poly's reference system. Paragrid needs references to work correctly, so any issues found are valuable bugs to fix in ts-poly.

### Q2: CutoffNode Rendering
**Status**: Design decision

Options:
1. Render nothing (clean, but may confuse)
2. Small marker (helpful for debugging)
3. Different floor color (subtle indicator)

**Plan**: Start with option 1, add option 2 in debug mode.

### Q3: Performance with Many Refs
**Status**: Unknown

If a grid has many refs to complex grids, iso-render's reference system should be efficient. But need to verify.

**Plan**: Test with 10×10 grid full of refs, measure performance, optimize if needed.

## References

- Python implementation: `python/paragrid.py` (lines 234-346)
- Existing isometric renderer: `web/src/lib/renderer/simple-iso.ts`
- ts-poly reference docs: `/Users/james.hopkin/code/personal/ts-poly/src/translator/reference-ordering.ts`
- Design doc format: `docs/design.md`, `docs/isometric-rendering-plan.md`
