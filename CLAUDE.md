# Paragrid - Project Context

**Paragrid** is a visualization system for recursive grid structures with references and teleportation semantics.

## Core Concepts

**Grids**: 2D arrays of cells (min 1×2), identified by string ID. Each grid is defined independently.

**Cell Types**:
- `Empty` — no content
- `Concrete(id)` — leaf value with string identifier
- `Ref(grid_id)` — reference to another grid

**Primary/Secondary References**: Each referenced grid has exactly one **primary** reference. All other refs to the same grid are **secondary**. When exiting a grid via a secondary ref, traversal **teleports** to the primary ref location before continuing.

**Cycles Allowed**: Grids can reference themselves or form mutual recursion.

## Architecture

**Two-Phase Visualization**:
1. **Analyze**: DFS traversal with rational dimensions (using `Fraction`), produces `CellTree`
2. **Render**: Walks tree with output-specific logic (current: ASCII with colors)

**Traversal**: Cardinal direction movement (N/S/E/W) across grids with automatic entry/exit and teleportation through reference cells.

## Key Implementation Details

- **Rational arithmetic**: Uses `Fraction` for exact math, enables LCM scaling for pixel-perfect output
- **Threshold termination**: Handles cycles by stopping when cell dimensions < 1/32 (configurable)
- **Single-cell references**: Each ref occupies exactly one cell (no multi-cell spans)
- **Aspect ratio inheritance**: Referenced grids stretch/squash to fill their parent cell
- **Type checking**: Uses `mypy --strict`
