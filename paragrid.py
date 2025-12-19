"""
Recursive grid structure with cycle-aware visualization.
Two-phase algorithm: analyze (builds CellTree) -> render (ASCII output).
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from fractions import Fraction
from math import lcm
from typing import Callable, Iterator, Union

import simple_chalk as chalk  # type: ignore[import-untyped]


class Direction(Enum):
    """Cardinal direction for traversal."""

    N = "N"  # Up (decreasing row)
    S = "S"  # Down (increasing row)
    E = "E"  # Right (increasing col)
    W = "W"  # Left (decreasing col)


# =============================================================================
# Data Structures: Grid Definition
# =============================================================================


@dataclass(frozen=True)
class Empty:
    """An empty cell."""

    pass


@dataclass(frozen=True)
class Concrete:
    """A cell containing a concrete value."""

    id: str


@dataclass(frozen=True)
class Ref:
    """A cell referencing another grid."""

    grid_id: str


Cell = Empty | Concrete | Ref


@dataclass(frozen=True)
class Grid:
    """A 2D grid of cells."""

    id: str
    cells: tuple[tuple[Cell, ...], ...]

    @property
    def rows(self) -> int:
        return len(self.cells)

    @property
    def cols(self) -> int:
        return len(self.cells[0]) if self.cells else 0


GridStore = dict[str, Grid]


# =============================================================================
# Data Structures: Analysis Result (CellTree)
# =============================================================================


@dataclass(frozen=True)
class EmptyNode:
    """Analyzed explicitly empty cell."""

    pass


@dataclass(frozen=True)
class CutoffNode:
    """Cell below recursion threshold (had more content)."""

    pass


@dataclass(frozen=True)
class ConcreteNode:
    """Analyzed concrete cell."""

    id: str
    grid_id: str  # Which grid this cell belongs to


@dataclass(frozen=True)
class NestedNode:
    """Analyzed nested grid."""

    grid_id: str
    children: tuple[tuple[CellNode, ...], ...]


CellNode = EmptyNode | CutoffNode | ConcreteNode | NestedNode


# =============================================================================
# Phase 1: Analyze
# =============================================================================


def analyze(
    store: GridStore,
    grid_id: str,
    width: Fraction,
    height: Fraction,
    threshold: Fraction = Fraction(1, 10),
) -> CellNode:
    """
    Build a CellTree by DFS traversal with rational dimensions.
    Terminates when cell dimensions fall below threshold.
    """
    if width < threshold or height < threshold:
        return CutoffNode()

    grid = store[grid_id]
    cell_width = width / grid.cols
    cell_height = height / grid.rows

    rows: list[tuple[CellNode, ...]] = []
    for row in grid.cells:
        cols: list[CellNode] = []
        for cell in row:
            match cell:
                case Empty():
                    cols.append(EmptyNode())
                case Concrete(id=cell_id):
                    cols.append(ConcreteNode(cell_id, grid_id))
                case Ref(grid_id=ref_id):
                    cols.append(analyze(store, ref_id, cell_width, cell_height, threshold))
                case _:
                    raise ValueError(f"Unknown cell type: {cell}")
        rows.append(tuple(cols))

    return NestedNode(grid_id, tuple(rows))


# =============================================================================
# Traversal
# =============================================================================


@dataclass(frozen=True)
class CellPosition:
    """A position within the grid structure."""

    grid_id: str
    row: int
    col: int


# Type alias for the try_enter callback
TryEnter = Callable[[str, Direction], CellPosition | None]


def find_primary_ref(store: GridStore, target_grid_id: str) -> tuple[str, int, int] | None:
    """
    Find the primary reference to a grid.
    For now, returns the first reference found (could be extended to support explicit marking).
    Returns (parent_grid_id, row, col) or None if not found.
    """
    for grid in store.values():
        for r, row in enumerate(grid.cells):
            for c, cell in enumerate(row):
                if isinstance(cell, Ref) and cell.grid_id == target_grid_id:
                    return (grid.id, r, c)
    return None


def traverse(
    store: GridStore,
    start: CellPosition,
    direction: Direction,
    try_enter: TryEnter,
) -> Iterator[CellPosition]:
    """
    Traverse the grid structure in a cardinal direction, yielding each cell visited.

    When exiting a grid:
    - If we entered via a secondary reference, teleport to the primary reference
    - Exit from the primary's position in its parent grid
    - If at root level (no parent), terminate

    Args:
        store: The grid store containing all grids
        start: Starting cell position
        direction: Cardinal direction to traverse
        try_enter: Callback to decide whether to enter a Ref cell.
                   Returns the entry CellPosition if entering, None otherwise.

    Yields:
        CellPosition for each cell visited
    """
    current = start
    yield current

    # Direction deltas: (row_delta, col_delta)
    deltas = {
        Direction.N: (-1, 0),
        Direction.S: (1, 0),
        Direction.E: (0, 1),
        Direction.W: (0, -1),
    }
    dr, dc = deltas[direction]

    while True:
        grid = store[current.grid_id]
        next_row = current.row + dr
        next_col = current.col + dc

        # Check if we're at the edge
        if next_row < 0 or next_row >= grid.rows or next_col < 0 or next_col >= grid.cols:
            # At edge - find primary reference to exit through
            primary = find_primary_ref(store, current.grid_id)
            if primary is None:
                # No parent (root grid) - terminate
                return

            # Teleport to primary reference location and continue
            parent_grid_id, parent_row, parent_col = primary
            parent_grid = store[parent_grid_id]

            # Move in the same direction from the primary ref's position
            exit_row = parent_row + dr
            exit_col = parent_col + dc

            if (
                exit_row < 0
                or exit_row >= parent_grid.rows
                or exit_col < 0
                or exit_col >= parent_grid.cols
            ):
                # Exiting parent grid too - recurse by updating current and looping
                current = CellPosition(parent_grid_id, parent_row, parent_col)
                continue

            current = CellPosition(parent_grid_id, exit_row, exit_col)
        else:
            # Normal movement within grid
            current = CellPosition(current.grid_id, next_row, next_col)

        yield current

        # Check if current cell is a Ref and try to enter
        cell = store[current.grid_id].cells[current.row][current.col]
        if isinstance(cell, Ref):
            entry = try_enter(cell.grid_id, direction)
            if entry is not None:
                current = entry
                yield current


# =============================================================================
# Phase 2: Render (ASCII)
# =============================================================================


def collect_denominators(node: CellNode) -> set[int]:
    """Collect all denominators from nested grid dimensions."""
    denoms: set[int] = set()

    def walk(n: CellNode, w: Fraction, h: Fraction) -> None:
        if isinstance(n, NestedNode):
            rows = len(n.children)
            cols = len(n.children[0]) if n.children else 0
            if cols > 0 and rows > 0:
                cw = w / cols
                ch = h / rows
                denoms.add(cw.denominator)
                denoms.add(ch.denominator)
                for row in n.children:
                    for child in row:
                        walk(child, cw, ch)

    walk(node, Fraction(1), Fraction(1))
    return denoms


def compute_scale(node: CellNode) -> tuple[int, int]:
    """Compute character dimensions that give exact integer cell sizes."""
    denoms = collect_denominators(node)
    if not denoms:
        return (1, 1)
    scale = 1
    for d in denoms:
        scale = lcm(scale, d)
    return (scale, scale)


def render_to_buffer(
    node: CellNode,
    buffer: list[list[str]],
    x: int,
    y: int,
    w: int,
    h: int,
    color_fn: Callable[[str], Callable[[str], str]],
) -> None:
    """Render a CellNode into a character buffer at the given position."""
    if w <= 0 or h <= 0:
        return

    match node:
        case EmptyNode():
            # Draw border with dash (explicitly empty)
            if w >= 3 and h >= 3:
                # Draw outline
                for col in range(x, x + w):
                    buffer[y][col] = "-"  # top edge
                    buffer[y + h - 1][col] = "-"  # bottom edge
                for row in range(y, y + h):
                    buffer[row][x] = "-"  # left edge
                    buffer[row][x + w - 1] = "-"  # right edge
            else:
                # Fill (too small for outline)
                for row in range(y, y + h):
                    for col in range(x, x + w):
                        buffer[row][col] = "-"

        case CutoffNode():
            # Fill with space (below threshold, had more content)
            for row in range(y, y + h):
                for col in range(x, x + w):
                    buffer[row][col] = "-"

        case ConcreteNode(id=cell_id, grid_id=gid):
            base_char = cell_id[0] if cell_id else "?"
            colorize = color_fn(gid)
            char = colorize(base_char)
            if w >= 3 and h >= 3:
                # Draw outline
                for col in range(x, x + w):
                    buffer[y][col] = char  # top edge
                    buffer[y + h - 1][col] = char  # bottom edge
                for row in range(y, y + h):
                    buffer[row][x] = char  # left edge
                    buffer[row][x + w - 1] = char  # right edge
            else:
                # Fill (too small for outline)
                for row in range(y, y + h):
                    for col in range(x, x + w):
                        buffer[row][col] = char

        case NestedNode(children=children):
            rows = len(children)
            cols = len(children[0]) if children else 0

            if cols == 0 or rows == 0:
                return

            cell_w = w // cols
            cell_h = h // rows

            for r_idx, child_row in enumerate(children):
                for c_idx, child in enumerate(child_row):
                    render_to_buffer(
                        child,
                        buffer,
                        x + c_idx * cell_w,
                        y + r_idx * cell_h,
                        cell_w,
                        cell_h,
                        color_fn,
                    )


def collect_grid_ids(node: CellNode) -> set[str]:
    """Collect all grid IDs from the tree."""
    ids: set[str] = set()

    def walk(n: CellNode) -> None:
        if isinstance(n, ConcreteNode):
            ids.add(n.grid_id)
        elif isinstance(n, NestedNode):
            for row in n.children:
                for child in row:
                    walk(child)

    walk(node)
    return ids


def render(node: CellNode) -> str:
    """Render a CellTree to an ASCII string with colors."""
    char_w, char_h = compute_scale(node)

    # Build color palette for grids
    colors: list[Callable[[str], str]] = [
        chalk.red,
        chalk.green,
        chalk.yellow,
        chalk.blue,
        chalk.magenta,
        chalk.cyan,
        chalk.redBright,
        chalk.greenBright,
        chalk.yellowBright,
        chalk.blueBright,
    ]
    grid_ids = sorted(collect_grid_ids(node))
    grid_colors: dict[str, Callable[[str], str]] = {
        gid: colors[i % len(colors)] for i, gid in enumerate(grid_ids)
    }

    def color_fn(grid_id: str) -> Callable[[str], str]:
        return grid_colors.get(grid_id, lambda s: s)

    # Create buffer
    buffer: list[list[str]] = [[" " for _ in range(char_w)] for _ in range(char_h)]

    # Render into buffer
    render_to_buffer(node, buffer, 0, 0, char_w, char_h, color_fn)

    # Convert to string
    return "\n".join("".join(row) for row in buffer)


def render_to_buffer_with_visits(
    node: CellNode,
    buffer: list[list[str]],
    x: int,
    y: int,
    w: int,
    h: int,
    color_fn: Callable[[str], Callable[[str], str]],
    visit_map: dict[tuple[str, int, int], list[int]],
) -> None:
    """Render a CellNode into a character buffer with visit numbers overlaid."""
    if w <= 0 or h <= 0:
        return

    match node:
        case EmptyNode():
            # Draw border with dash (explicitly empty)
            if w >= 3 and h >= 3:
                # Draw outline
                for col in range(x, x + w):
                    buffer[y][col] = "-"  # top edge
                    buffer[y + h - 1][col] = "-"  # bottom edge
                for row in range(y, y + h):
                    buffer[row][x] = "-"  # left edge
                    buffer[row][x + w - 1] = "-"  # right edge
            else:
                # Fill (too small for outline)
                for row in range(y, y + h):
                    for col in range(x, x + w):
                        buffer[row][col] = "-"

        case CutoffNode():
            # Fill with dash (below threshold, had more content)
            for row in range(y, y + h):
                for col in range(x, x + w):
                    buffer[row][col] = "-"

        case ConcreteNode(id=cell_id, grid_id=gid):
            base_char = cell_id[0] if cell_id else "?"
            colorize = color_fn(gid)
            char = colorize(base_char)
            if w >= 3 and h >= 3:
                # Draw outline
                for col in range(x, x + w):
                    buffer[y][col] = char  # top edge
                    buffer[y + h - 1][col] = char  # bottom edge
                for row in range(y, y + h):
                    buffer[row][x] = char  # left edge
                    buffer[row][x + w - 1] = char  # right edge
            else:
                # Fill (too small for outline)
                for row in range(y, y + h):
                    for col in range(x, x + w):
                        buffer[row][col] = char

        case NestedNode(grid_id=gid, children=children):
            rows = len(children)
            cols = len(children[0]) if children else 0

            if cols == 0 or rows == 0:
                return

            cell_w = w // cols
            cell_h = h // rows

            for r_idx, child_row in enumerate(children):
                for c_idx, child in enumerate(child_row):
                    child_x = x + c_idx * cell_w
                    child_y = y + r_idx * cell_h

                    # Recursively render the child
                    render_to_buffer_with_visits(
                        child,
                        buffer,
                        child_x,
                        child_y,
                        cell_w,
                        cell_h,
                        color_fn,
                        visit_map,
                    )

                    # Overlay visit numbers for this cell position
                    key = (gid, r_idx, c_idx)
                    if key in visit_map:
                        steps = visit_map[key]
                        step_str = ",".join(str(s) for s in steps)
                        # Center the string in the cell
                        center_x = child_x + cell_w // 2
                        center_y = child_y + cell_h // 2
                        start_x = center_x - len(step_str) // 2
                        # Write the string
                        for i, ch in enumerate(step_str):
                            write_x = start_x + i
                            if 0 <= write_x < len(buffer[0]) and 0 <= center_y < len(buffer):
                                buffer[center_y][write_x] = ch


def render_with_visits(
    node: CellNode,
    visit_map: dict[tuple[str, int, int], list[int]],
    min_scale: int = 1,
) -> str:
    """Render a CellTree to ASCII with visit step numbers overlaid."""
    char_w, char_h = compute_scale(node)
    char_w = max(char_w, min_scale)
    char_h = max(char_h, min_scale)

    # Build color palette for grids
    colors: list[Callable[[str], str]] = [
        chalk.red,
        chalk.green,
        chalk.yellow,
        chalk.blue,
        chalk.magenta,
        chalk.cyan,
        chalk.redBright,
        chalk.greenBright,
        chalk.yellowBright,
        chalk.blueBright,
    ]
    grid_ids = sorted(collect_grid_ids(node))
    grid_colors: dict[str, Callable[[str], str]] = {
        gid: colors[i % len(colors)] for i, gid in enumerate(grid_ids)
    }

    def color_fn(grid_id: str) -> Callable[[str], str]:
        return grid_colors.get(grid_id, lambda s: s)

    # Create buffer
    buffer: list[list[str]] = [[" " for _ in range(char_w)] for _ in range(char_h)]

    # Render with visits
    render_to_buffer_with_visits(node, buffer, 0, 0, char_w, char_h, color_fn, visit_map)

    # Convert to string
    return "\n".join("".join(row) for row in buffer)


# =============================================================================
# Demo
# =============================================================================


def demo() -> None:
    """Demonstrate the recursive grid visualization."""
    # Define some grids
    store: GridStore = {
        # A simple 2x2 grid with concrete values
        "simple": Grid(
            "simple",
            (
                (Concrete("a"), Concrete("b")),
                (Concrete("c"), Concrete("d")),
            ),
        ),
        # A grid that references another grid
        "nested": Grid(
            "nested",
            (
                (Ref("simple"), Concrete("x")),
                (Concrete("y"), Empty()),
            ),
        ),
        # A self-referencing grid (cycle!)
        "recursive": Grid(
            "recursive",
            (
                (Concrete("r"), Ref("recursive")),
                (Concrete("s"), Concrete("t")),
            ),
        ),
        # Mutual recursion: A references B, B references A
        "alpha": Grid(
            "alpha",
            (
                (Concrete("X"), Ref("beta")),
                (Concrete("Y"), Concrete("Z")),
            ),
        ),
        "beta": Grid(
            "beta",
            (
                (Ref("alpha"), Concrete("a")),
                (Concrete("b"), Concrete("c")),
            ),
        ),
    }

    print("=" * 40)
    print("Simple 2x2 grid:")
    print("=" * 40)
    tree = analyze(store, "simple", Fraction(1), Fraction(1))
    print(render(tree))
    print()

    print("=" * 40)
    print("Nested grid (top-left contains 'simple'):")
    print("=" * 40)
    tree = analyze(store, "nested", Fraction(1), Fraction(1))
    print(render(tree))
    print()

    print("=" * 40)
    print("Self-recursive grid:")
    print("=" * 40)
    tree = analyze(store, "recursive", Fraction(1), Fraction(1))
    print(render(tree))
    print()

    print("=" * 40)
    print("Mutual recursion (alpha <-> beta):")
    print("=" * 40)
    tree = analyze(store, "alpha", Fraction(1), Fraction(1))
    print(render(tree))


def traversal_demo() -> None:
    """Demonstrate grid traversal with step numbers shown in rendered output."""
    # Main grid with empty cells around refs to show entry/exit clearly
    store: GridStore = {
        "main": Grid(
            "main",
            (
                (Empty(), Empty(), Empty(), Empty()),
                (Empty(), Ref("inner"), Ref("inner"), Empty()),  # Two refs to same grid
                (Empty(), Concrete("X"), Concrete("Y"), Empty()),
                (Empty(), Empty(), Empty(), Empty()),
            ),
        ),
        "inner": Grid(
            "inner",
            (
                (Concrete("A"), Concrete("B")),
                (Concrete("C"), Concrete("D")),
            ),
        ),
    }

    # try_enter: always enter from the edge based on direction
    def try_enter(grid_id: str, direction: Direction) -> CellPosition | None:
        grid = store[grid_id]
        match direction:
            case Direction.N:
                return CellPosition(grid_id, grid.rows - 1, 0)  # Enter from bottom
            case Direction.S:
                return CellPosition(grid_id, 0, 0)  # Enter from top
            case Direction.E:
                return CellPosition(grid_id, 0, 0)  # Enter from left
            case Direction.W:
                return CellPosition(grid_id, 0, grid.cols - 1)  # Enter from right

    print("=" * 60)
    print("Traversal Demo: Main grid with two refs to Inner")
    print("=" * 60)
    print()
    print("Grid structure:")
    print("  Main (4x4):          Inner (2x2):")
    print("  ┌───┬───┬───┬───┐    ┌───┬───┐")
    print("  │ _ │ _ │ _ │ _ │    │ A │ B │")
    print("  ├───┼───┼───┼───┤    ├───┼───┤")
    print("  │ _ │Ref│Ref│ _ │    │ C │ D │")
    print("  │   │(P)│(s)│   │    └───┴───┘")
    print("  ├───┼───┼───┼───┤")
    print("  │ _ │ X │ Y │ _ │")
    print("  ├───┼───┼───┼───┤")
    print("  │ _ │ _ │ _ │ _ │")
    print("  └───┴───┴───┴───┘")
    print()

    # Traverse from (main, 1, 3) going West - should enter inner, traverse, teleport, exit
    start = CellPosition("main", 1, 3)
    print(f"Traversal: start at (main, {start.row}, {start.col}), direction = West")
    print()

    # Collect visits into a map
    visit_map: dict[tuple[str, int, int], list[int]] = {}
    for i, pos in enumerate(traverse(store, start, Direction.W, try_enter)):
        key = (pos.grid_id, pos.row, pos.col)
        if key not in visit_map:
            visit_map[key] = []
        visit_map[key].append(i)
        print(f"  Step {i}: {pos.grid_id}[{pos.row},{pos.col}]")
        if i > 20:  # Safety limit
            print("  ... (truncated)")
            break

    print()
    print("Visualization with visit step numbers:")
    print()

    # Analyze and render with visits
    tree = analyze(store, "main", Fraction(1), Fraction(1))
    output = render_with_visits(tree, visit_map, min_scale=40)
    print(output)


if __name__ == "__main__":
    demo()
    print()
    traversal_demo()

