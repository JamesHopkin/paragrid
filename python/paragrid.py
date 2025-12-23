"""
Recursive grid structure with cycle-aware visualization.
Two-phase algorithm: analyze (builds CellTree) -> render (ASCII output).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from enum import Enum
from fractions import Fraction
from math import lcm
from typing import Callable, Iterator, Union

import simple_chalk as chalk  # type: ignore[import-untyped]

logger = logging.getLogger(__name__)


class Direction(Enum):
    """Cardinal direction for traversal."""

    N = "N"  # Up (decreasing row)
    S = "S"  # Down (increasing row)
    E = "E"  # Right (increasing col)
    W = "W"  # Left (decreasing col)


class TerminationReason(Enum):
    """Reason why traversal terminated."""

    EDGE_REACHED = "edge_reached"  # Hit edge of root grid
    ENTRY_CYCLE_DETECTED = "entry_cycle_detected"  # Cycle in Ref chain during entry
    EXIT_CYCLE_DETECTED = "exit_cycle_detected"  # Cycle in exit chain through parents
    PATH_CYCLE_DETECTED = "path_cycle_detected"  # Cycle in traversal path (push only)
    ENTRY_DENIED = "entry_denied"  # try_enter returned None
    MAX_DEPTH_REACHED = "max_depth_reached"  # Hit max_depth limit
    STOP_TAG = "stop_tag"  # Cell has 'stop' tag


class RefStrategy(Enum):
    """Strategy for handling Ref cells in operations."""

    TRY_ENTER_FIRST = "try_enter_first"  # Try portal first, fall back to solid
    PUSH_FIRST = "push_first"  # Try solid first, backtrack can try portal


@dataclass(frozen=True)
class RuleSet:
    """Rules governing operation behavior."""

    ref_strategy: RefStrategy = RefStrategy.PUSH_FIRST


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
    is_primary: bool | None = None  # None = auto-determine, True/False = explicit


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


def parse_grids(definitions: dict[str, str]) -> GridStore:
    """
    Parse grid definitions from a compact string format.

    Format:
    - Rows separated by |
    - Cells separated by spaces
    - Cell type determined by FIRST CHARACTER (allows multi-character content/refs):
      * First char is digit (0-9): Concrete cell with entire string as content
        Examples: "1" -> Concrete("1"), "123abc" -> Concrete("123abc")
      * First char is letter (a-zA-Z): Ref cell with entire string as grid_id (auto-determined primary)
        Examples: "A" -> Ref("A"), "Main" -> Ref("Main"), "Grid2" -> Ref("Grid2")
      * First char is '*': Primary ref, remainder is grid_id (must have at least 1 char after *)
        Examples: "*A" -> Ref("A", is_primary=True), "*Main" -> Ref("Main", is_primary=True)
      * First char is '~': Secondary ref, remainder is grid_id (must have at least 1 char after ~)
        Examples: "~A" -> Ref("A", is_primary=False), "~Grid2" -> Ref("Grid2", is_primary=False)
      * Underscore only (_): Empty cell
      * Empty string (from multiple adjacent spaces): Empty cell

    Example:
        {
            "main": "123 abc|xyz *Main",
            "Main": "5|6"
        }
        Creates:
        - Grid "main": 2x2 with [Concrete("123"), Concrete("abc")], [Concrete("xyz"), Ref("Main", is_primary=True)]
        - Grid "Main": 2x1 with [Concrete("5")], [Concrete("6")]

    Args:
        definitions: Dict mapping grid_id to string definition

    Returns:
        GridStore with parsed grids
    """
    store: GridStore = {}

    for grid_id, definition in definitions.items():
        # Split into rows
        row_strings = definition.split("|")
        rows: list[tuple[Cell, ...]] = []

        for row_idx, row_str in enumerate(row_strings):
            # Split by single space to get individual cells
            # Multiple spaces = multiple empty cells
            cell_strings = row_str.split(" ")
            cells: list[Cell] = []

            for col_idx, cell_str in enumerate(cell_strings):
                if not cell_str:  # Empty string from split = Empty cell
                    cells.append(Empty())
                elif cell_str == "_":  # Explicit empty marker
                    cells.append(Empty())
                elif cell_str[0].isdigit():  # First char is digit = Concrete
                    cells.append(Concrete(cell_str))
                elif cell_str[0].isalpha():  # First char is letter = Ref (auto-determined)
                    cells.append(Ref(cell_str, is_primary=None))
                elif cell_str.startswith("*") and len(cell_str) >= 2:
                    # *... = Primary ref (rest is grid_id)
                    cells.append(Ref(cell_str[1:], is_primary=True))
                elif cell_str.startswith("~") and len(cell_str) >= 2:
                    # ~... = Secondary ref (rest is grid_id)
                    cells.append(Ref(cell_str[1:], is_primary=False))
                else:
                    # Provide detailed error information
                    error_msg = (
                        f"Invalid cell string: '{cell_str}'\n"
                        f"  Grid: '{grid_id}'\n"
                        f"  Row {row_idx}: \"{row_str}\"\n"
                        f"  Position: column {col_idx}\n"
                        f"  Valid formats:\n"
                        f"    - Digit start (0-9...): Concrete cell (e.g., '1', '123abc')\n"
                        f"    - Letter start (a-zA-Z...): Ref cell (e.g., 'A', 'Main')\n"
                        f"    - '*' prefix: Primary ref (e.g., '*A', '*Main')\n"
                        f"    - '~' prefix: Secondary ref (e.g., '~A', '~Main')\n"
                        f"    - '_': Empty cell\n"
                        f"    - Empty string (multiple spaces): Empty cell"
                    )
                    raise ValueError(error_msg)

            rows.append(tuple(cells))

        # Validate all rows have same length
        if rows:
            cols = len(rows[0])
            mismatched = [(i, len(row)) for i, row in enumerate(rows) if len(row) != cols]
            if mismatched:
                error_msg = (
                    f"Inconsistent row lengths in grid '{grid_id}'\n"
                    f"  Expected: {cols} columns (from row 0)\n"
                    f"  Mismatched rows:\n"
                )
                for row_idx, actual_cols in mismatched:
                    error_msg += f"    Row {row_idx}: {actual_cols} columns - \"{row_strings[row_idx]}\"\n"
                error_msg += f"  All rows must have the same number of cells"
                raise ValueError(error_msg)

        # Create Grid
        grid = Grid(grid_id, tuple(rows))
        store[grid_id] = grid

    return store


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


@dataclass(frozen=True)
class RefNode:
    """A reference to another grid (wraps the nested content)."""

    grid_id: str  # The grid this ref belongs to
    ref_target: str  # The grid being referenced
    is_primary: bool  # Whether this is the primary reference
    content: "CellNode"  # The analyzed content of the referenced grid


CellNode = EmptyNode | CutoffNode | ConcreteNode | NestedNode | RefNode


# =============================================================================
# Phase 1: Analyze
# =============================================================================


def analyze(
    store: GridStore,
    grid_id: str,
    width: Fraction,
    height: Fraction,
    threshold: Fraction = Fraction(1, 10),
    primary_refs: set[str] | None = None,
) -> CellNode:
    """
    Build a CellTree by DFS traversal with rational dimensions.
    Terminates when cell dimensions fall below threshold.

    Args:
        store: The grid store
        grid_id: The grid to analyze
        width: The width to render this grid at
        height: The height to render this grid at
        threshold: Minimum dimension before cutoff
        primary_refs: Set to track which grids have been referenced (for primary detection)
    """
    if primary_refs is None:
        primary_refs = set()

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
                case Ref(grid_id=ref_id, is_primary=explicit_primary):
                    # Check if this is the primary reference
                    if explicit_primary is True:
                        # Explicitly marked as primary
                        is_primary = True
                        primary_refs.add(ref_id)
                    elif explicit_primary is False:
                        # Explicitly marked as non-primary
                        is_primary = False
                    else:
                        # Auto-determine: first ref to this grid is primary
                        is_primary = ref_id not in primary_refs
                        if is_primary:
                            primary_refs.add(ref_id)

                    # Analyze the referenced grid
                    content = analyze(store, ref_id, cell_width, cell_height, threshold, primary_refs)

                    # Wrap in RefNode
                    cols.append(RefNode(grid_id, ref_id, is_primary, content))
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

# Type alias for the tagging function
TagFn = Callable[[Cell], set[str]]


@dataclass
class DecisionPoint:
    """
    Decision point for backtracking in push operations.

    Tracks a point where we made a Ref handling decision. If the push fails,
    we can backtrack to this point and retry with the alternative strategy.
    """

    ref_position: CellPosition  # Location of the Ref we handled
    ref_cell: Ref  # The Ref cell itself
    path_snapshot: list[tuple[CellPosition, Cell]]  # Path before decision
    visited_snapshot: set[tuple[str, int, int]]  # Visited set before decision
    depth_at_decision: int  # Traversal depth at this point
    strategy_used: str  # "portal" or "solid" - which strategy was tried


class TraversalResult:
    """
    Iterator wrapper for traverse() that tracks termination reason.

    Usage:
        result = traverse(store, start, direction, try_enter)
        for pos in result:
            print(pos)
        print(result.termination_reason)  # Why traversal ended
    """

    def __init__(
        self,
        generator: Iterator[CellPosition],
    ):
        self._iterator = generator
        self.termination_reason: TerminationReason | None = None

    def __iter__(self) -> Iterator[CellPosition]:
        return self

    def __next__(self) -> CellPosition:
        return next(self._iterator)


def find_primary_ref(store: GridStore, target_grid_id: str) -> tuple[str, int, int] | None:
    """
    Find the primary reference to a grid.
    First looks for explicitly marked primary (is_primary=True), then falls back to first ref found.
    Returns (parent_grid_id, row, col) or None if not found.
    """
    # First pass: look for explicitly marked primary
    for grid in store.values():
        for r, row in enumerate(grid.cells):
            for c, cell in enumerate(row):
                if isinstance(cell, Ref) and cell.grid_id == target_grid_id and cell.is_primary is True:
                    return (grid.id, r, c)

    # Second pass: fall back to first ref found
    for grid in store.values():
        for r, row in enumerate(grid.cells):
            for c, cell in enumerate(row):
                if isinstance(cell, Ref) and cell.grid_id == target_grid_id:
                    return (grid.id, r, c)
    return None


def _follow_enter_chain(
    store: GridStore,
    entry: CellPosition,
    direction: Direction,
    rules: RuleSet,
    max_depth: int,
) -> tuple[CellPosition | None, bool]:
    """
    Follow a chain of Ref cells on entry until hitting a non-Ref or cycle.

    Args:
        store: The grid store containing all grids
        entry: Starting position inside the referenced grid
        direction: Direction of traversal
        rules: RuleSet governing entry behavior
        max_depth: Maximum number of jumps to prevent infinite loops

    Returns:
        (final_position, hit_cycle) where:
        - final_position is None if try_enter denied entry mid-chain
        - hit_cycle is True if we detected a cycle
    """
    visited: set[tuple[str, int, int]] = set()
    current = entry
    depth = 0

    while depth < max_depth:
        # Check for cycle
        key = (current.grid_id, current.row, current.col)
        if key in visited:
            return (current, True)
        visited.add(key)

        # Check if current cell is a Ref
        grid = store[current.grid_id]
        cell = grid.cells[current.row][current.col]

        if not isinstance(cell, Ref):
            # Hit a non-Ref, we're done
            return (current, False)

        # It's a Ref, try to enter it
        next_entry = try_enter(store, cell.grid_id, direction, rules)
        if next_entry is None:
            # Entry denied mid-chain
            return (None, False)

        current = next_entry
        depth += 1

    # Hit max_depth, treat as cycle
    return (current, True)


def _follow_exit_chain(
    store: GridStore,
    exit_pos: CellPosition,
    direction: Direction,
    rules: RuleSet,
    max_depth: int,
) -> tuple[CellPosition | None, bool]:
    """
    Follow a chain of Ref cells on exit until hitting a non-Ref or cycle.

    When landing on a Ref during exit, immediately exit through it
    until we reach a non-Ref cell or detect a cycle.

    Args:
        store: The grid store containing all grids
        exit_pos: Starting position in parent grid after exiting
        direction: Direction of traversal
        rules: RuleSet governing entry behavior
        max_depth: Maximum number of jumps to prevent infinite loops

    Returns:
        (final_position, hit_cycle) where:
        - final_position is None if we exit the root grid
        - hit_cycle is True if we detected a cycle
    """
    visited: set[tuple[str, int, int]] = set()
    current = exit_pos
    depth = 0

    # Direction deltas
    deltas = {
        Direction.N: (-1, 0),
        Direction.S: (1, 0),
        Direction.E: (0, 1),
        Direction.W: (0, -1),
    }
    dr, dc = deltas[direction]

    while depth < max_depth:
        # Check for cycle
        key = (current.grid_id, current.row, current.col)
        if key in visited:
            return (current, True)
        visited.add(key)

        # Check if current cell is a Ref
        grid = store[current.grid_id]
        cell = grid.cells[current.row][current.col]

        if not isinstance(cell, Ref):
            # Hit a non-Ref, we're done
            return (current, False)

        # It's a Ref, we need to exit through it
        # Find the primary reference for the grid this Ref points to
        primary = find_primary_ref(store, cell.grid_id)
        if primary is None:
            # This Ref points to the root grid, can't exit further
            return (None, False)

        # Teleport to primary reference location
        parent_grid_id, parent_row, parent_col = primary
        parent_grid = store[parent_grid_id]

        # Calculate exit position from primary ref
        exit_row = parent_row + dr
        exit_col = parent_col + dc

        if (
            exit_row < 0
            or exit_row >= parent_grid.rows
            or exit_col < 0
            or exit_col >= parent_grid.cols
        ):
            # Exiting parent grid too, need to continue up the chain
            current = CellPosition(parent_grid_id, parent_row, parent_col)
        else:
            # Exit position is valid
            current = CellPosition(parent_grid_id, exit_row, exit_col)

        depth += 1

    # Hit max_depth, treat as cycle
    return (current, True)


def _restore_from_decision(
    decision: DecisionPoint,
    alternative_strategy_refs: dict[tuple[str, int, int], str],
) -> tuple[CellPosition, list[tuple[CellPosition, Cell]], set[tuple[str, int, int]], int]:
    """
    Restore state from a decision point for backtracking.

    Marks the Ref from the decision point to use alternative strategy on retry.
    If "portal" was tried, marks it for "solid". If "solid" was tried, marks it for "portal".

    Args:
        decision: The decision point to backtrack to
        alternative_strategy_refs: Dict mapping Ref positions to alternative strategies (mutated)

    Returns:
        Tuple of (current_position, path, visited, depth) restored from decision point
    """
    # Mark this Ref to use alternative strategy
    ref_key = (decision.ref_position.grid_id, decision.ref_position.row, decision.ref_position.col)
    # Flip the strategy: portal <-> solid
    alternative_strategy = "solid" if decision.strategy_used == "portal" else "portal"
    alternative_strategy_refs[ref_key] = alternative_strategy

    # Restore state to just before the decision
    return (
        decision.ref_position,
        decision.path_snapshot.copy(),
        decision.visited_snapshot.copy(),
        decision.depth_at_decision,
    )


def traverse(
    store: GridStore,
    start: CellPosition,
    direction: Direction,
    try_enter: TryEnter,
    auto_enter: bool = False,
    auto_exit: bool = True,
    max_depth: int = 1000,
    tag_fn: TagFn | None = None,
) -> TraversalResult:
    """
    Traverse the grid structure in a cardinal direction, yielding each cell visited.

    When exiting a grid:
    - If we entered via a secondary reference, teleport to the primary reference
    - Exit from the primary's position in its parent grid
    - If auto_exit is True, automatically continue past the Ref cell
    - If auto_exit is False, yield the Ref cell and stop there

    Args:
        store: The grid store containing all grids
        start: Starting cell position
        direction: Cardinal direction to traverse
        try_enter: Callback to decide whether to enter a Ref cell.
                   Returns the entry CellPosition if entering, None otherwise.
                   Only used when auto_enter is False.
        auto_enter: If True, automatically enter all Refs without calling try_enter.
                    If False, call try_enter to decide whether to enter each Ref.
        auto_exit: If True, automatically continue past Ref cells when exiting.
                   If False, stop at the Ref cell when exiting.
        max_depth: Maximum number of automatic jumps to prevent infinite loops.
        tag_fn: Optional function to tag cell contents. If a cell has the 'stop' tag,
                traversal terminates before yielding that cell.

    Returns:
        TraversalResult iterator that yields CellPosition and tracks termination reason
    """
    result = TraversalResult.__new__(TraversalResult)
    result.termination_reason = None
    result._iterator = _traverse_generator(
        store, start, direction, try_enter, auto_enter, auto_exit, max_depth, tag_fn, result
    )
    return result


def _traverse_generator(
    store: GridStore,
    start: CellPosition,
    direction: Direction,
    try_enter: TryEnter,
    auto_enter: bool,
    auto_exit: bool,
    max_depth: int,
    tag_fn: TagFn | None,
    result: TraversalResult,
) -> Iterator[CellPosition]:
    """Internal generator for traverse(). Do not call directly."""

    def set_reason(reason: TerminationReason) -> None:
        if result.termination_reason is None:  # Only set first reason
            result.termination_reason = reason

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

    depth = 0
    while depth < max_depth:
        grid = store[current.grid_id]
        next_row = current.row + dr
        next_col = current.col + dc

        # Check if we're at the edge
        if next_row < 0 or next_row >= grid.rows or next_col < 0 or next_col >= grid.cols:
            # At edge - find primary reference to exit through
            primary = find_primary_ref(store, current.grid_id)
            if primary is None:
                # No parent (root grid) - terminate
                set_reason(TerminationReason.EDGE_REACHED)
                return

            # Teleport to primary reference location
            parent_grid_id, parent_row, parent_col = primary
            parent_grid = store[parent_grid_id]

            if not auto_exit:
                # Stop at the Ref we're exiting through
                current = CellPosition(parent_grid_id, parent_row, parent_col)
                yield current
                set_reason(TerminationReason.EDGE_REACHED)
                return

            # Auto-exit: continue in the same direction from the primary ref's position
            exit_row = parent_row + dr
            exit_col = parent_col + dc

            if (
                exit_row < 0
                or exit_row >= parent_grid.rows
                or exit_col < 0
                or exit_col >= parent_grid.cols
            ):
                # Exiting parent grid too - use chain following
                current = CellPosition(parent_grid_id, parent_row, parent_col)
                final_pos, hit_cycle = _follow_exit_chain(
                    store, current, direction, try_enter, max_depth - depth
                )
                if hit_cycle:
                    # Exit cycle detected, terminate
                    set_reason(TerminationReason.EXIT_CYCLE_DETECTED)
                    return
                if final_pos is None:
                    # Exited root grid
                    set_reason(TerminationReason.EDGE_REACHED)
                    return
                current = final_pos
                depth += 1
                continue

            # Exit position is valid
            # Note: if it's a Ref, the main loop will handle it with auto_enter logic
            current = CellPosition(parent_grid_id, exit_row, exit_col)
        else:
            # Normal movement within grid
            current = CellPosition(current.grid_id, next_row, next_col)

        # Get the cell at current position
        cell = store[current.grid_id].cells[current.row][current.col]

        # Check if cell has 'stop' tag
        if tag_fn is not None and "stop" in tag_fn(cell):
            set_reason(TerminationReason.STOP_TAG)
            return

        # Check if current cell is a Ref before yielding
        if isinstance(cell, Ref):
            if auto_enter:
                # Auto-enter: don't yield the Ref, follow chain to non-Ref
                entry = try_enter(cell.grid_id, direction)
                if entry is not None:
                    final_pos, hit_cycle = _follow_enter_chain(
                        store, entry, direction, try_enter, max_depth - depth
                    )
                    if hit_cycle:
                        # Entry cycle detected, terminate
                        set_reason(TerminationReason.ENTRY_CYCLE_DETECTED)
                        return
                    if final_pos is not None:
                        current = final_pos
                        yield current
                        depth += 1  # Once per chain, not per jump
                    else:
                        # try_enter denied mid-chain
                        set_reason(TerminationReason.ENTRY_DENIED)
                        return
                else:
                    # try_enter returned None immediately, stop before Ref
                    set_reason(TerminationReason.ENTRY_DENIED)
                    return
            else:
                # Yield the Ref cell first
                yield current
                # Then ask try_enter whether to enter
                entry = try_enter(cell.grid_id, direction)
                if entry is not None:
                    current = entry
                    yield current
                    depth += 1
                else:
                    # Chose not to enter, already yielded the Ref, stop here
                    set_reason(TerminationReason.ENTRY_DENIED)
                    return
        else:
            # Not a Ref, just yield it
            yield current

        depth = 0  # Reset depth counter on normal movement

    # If we exit the while loop, max_depth was reached
    set_reason(TerminationReason.MAX_DEPTH_REACHED)


def get_cell(store: GridStore, pos: CellPosition) -> Cell:
    """
    Get the cell at a given position in the grid store.

    Args:
        store: The grid store containing all grids
        pos: The position to look up

    Returns:
        The cell at the given position
    """
    grid = store[pos.grid_id]
    return grid.cells[pos.row][pos.col]


def try_enter(
    store: GridStore, grid_id: str, direction: Direction, rules: RuleSet
) -> CellPosition | None:
    """
    Determine entry point when entering a grid via a Ref.

    Returns the CellPosition to enter at, or None to deny entry.
    Currently implements only standard middle-of-edge entry based on direction.

    Entry Convention:
    - East (from left): (rows // 2, 0) — middle of left edge
    - West (from right): (rows // 2, cols - 1) — middle of right edge
    - South (from top): (0, cols // 2) — middle of top edge
    - North (from bottom): (rows - 1, cols // 2) — middle of bottom edge

    Args:
        store: The grid store containing all grids
        grid_id: ID of the grid to enter
        direction: Direction of entry
        rules: RuleSet governing entry behavior (currently unused)

    Returns:
        CellPosition for entry point, or None to deny entry
    """
    # Get the target grid
    if grid_id not in store:
        return None

    grid = store[grid_id]
    rows = grid.rows
    cols = grid.cols

    # Calculate middle-of-edge entry point based on direction
    if direction == Direction.E:
        # Entering from left edge
        return CellPosition(grid_id, rows // 2, 0)
    elif direction == Direction.W:
        # Entering from right edge
        return CellPosition(grid_id, rows // 2, cols - 1)
    elif direction == Direction.S:
        # Entering from top edge
        return CellPosition(grid_id, 0, cols // 2)
    elif direction == Direction.N:
        # Entering from bottom edge
        return CellPosition(grid_id, rows - 1, cols // 2)
    else:
        # Unknown direction
        return None


def push(
    store: GridStore,
    start: CellPosition,
    direction: Direction,
    rules: RuleSet,
    tag_fn: TagFn | None = None,
    max_depth: int = 1000,
    max_backtrack_depth: int = 10,
) -> GridStore | None:
    """
    Push cell contents along a path in the given direction (with backtracking).

    The push operation moves cell contents forward along a path, with the contents
    rotating when the push succeeds. Success occurs when:
    1. The path ends at an Empty cell, OR
    2. The path cycles back to the starting position

    When a push fails with the initial Ref handling strategy, this algorithm
    automatically backtracks and retries with the alternative strategy. Supports
    multiple levels of backtracking for nested Refs.

    Args:
        store: The grid store containing all grids
        start: Starting position for the push
        direction: Direction to push
        rules: RuleSet governing Ref handling behavior
        tag_fn: Optional function to tag cells (e.g., for 'stop' tag)
        max_depth: Maximum traversal depth to prevent infinite loops
        max_backtrack_depth: Maximum number of backtracking attempts (default 10)

    Returns:
        New GridStore with pushed contents if successful, None if push fails
    """
    # Perform backtracking traversal to build the path
    path, reason = push_traverse_backtracking(
        store, start, direction, rules, tag_fn, max_depth, max_backtrack_depth
    )

    # Check success conditions
    if reason == TerminationReason.EDGE_REACHED:
        # Success if path ends at Empty
        if path and isinstance(path[-1][1], Empty):
            return apply_push(store, path)
        else:
            # Hit edge without Empty - push fails
            return None

    elif reason == TerminationReason.PATH_CYCLE_DETECTED:
        # Success if cycle returns to start position
        if path and len(path) >= 2 and path[0][0] == start:
            # Check if the last attempted position would cycle to start
            # The path includes the start, so this is a valid cycle
            return apply_push(store, path)
        else:
            # Invalid cycle (to non-start position) - push fails
            return None

    else:
        # All other termination reasons are failures
        # (STOP_TAG, ENTRY_DENIED, ENTRY_CYCLE_DETECTED, EXIT_CYCLE_DETECTED, MAX_DEPTH_REACHED)
        return None


def push_simple(
    store: GridStore,
    start: CellPosition,
    direction: Direction,
    rules: RuleSet,
    tag_fn: TagFn | None = None,
    max_depth: int = 1000,
) -> GridStore | None:
    """
    Simple push operation without backtracking.

    The push operation moves cell contents forward along a path, with the contents
    rotating when the push succeeds. Success occurs when:
    1. The path ends at an Empty cell, OR
    2. The path cycles back to the starting position

    When a push fails with the initial Ref handling strategy, the entire push fails.
    This is the simpler algorithm without backtracking, kept for testing.

    Args:
        store: The grid store containing all grids
        start: Starting position for the push
        direction: Direction to push
        rules: RuleSet governing Ref handling behavior
        tag_fn: Optional function to tag cells (e.g., for 'stop' tag)
        max_depth: Maximum traversal depth to prevent infinite loops

    Returns:
        New GridStore with pushed contents if successful, None if push fails
    """
    # Perform custom traversal to build the path
    path, reason = push_traverse_simple(store, start, direction, rules, tag_fn, max_depth)

    # Check success conditions
    if reason == TerminationReason.EDGE_REACHED:
        # Success if path ends at Empty
        if path and isinstance(path[-1][1], Empty):
            return apply_push(store, path)
        else:
            # Hit edge without Empty - push fails
            return None

    elif reason == TerminationReason.PATH_CYCLE_DETECTED:
        # Success if cycle returns to start position
        if path and len(path) >= 2 and path[0][0] == start:
            # Check if the last attempted position would cycle to start
            # The path includes the start, so this is a valid cycle
            return apply_push(store, path)
        else:
            # Invalid cycle (to non-start position) - push fails
            return None

    else:
        # All other termination reasons are failures
        # (STOP_TAG, ENTRY_DENIED, ENTRY_CYCLE_DETECTED, EXIT_CYCLE_DETECTED, MAX_DEPTH_REACHED)
        return None


def push_traverse_simple(
    store: GridStore,
    start: CellPosition,
    direction: Direction,
    rules: RuleSet,
    tag_fn: TagFn | None = None,
    max_depth: int = 1000,
) -> tuple[list[tuple[CellPosition, Cell]], TerminationReason]:
    """
    Simple traversal for push operation without backtracking.

    This traversal has special Ref handling governed by the rule set:
    - If ref_strategy=TRY_ENTER_FIRST:
      * Try entry first; if succeeds, Ref acts as PORTAL (not in path)
      * If entry fails, Ref acts as SOLID object (included in path)
    - If ref_strategy=PUSH_FIRST:
      * Ref acts as SOLID object immediately (included in path)

    When push fails with initial strategy, the entire push fails with no retry.

    Args:
        store: The grid store containing all grids
        start: Starting position
        direction: Direction to traverse
        rules: RuleSet governing Ref handling behavior
        tag_fn: Optional function to tag cells (e.g., for 'stop' tag)
        max_depth: Maximum number of steps to prevent infinite loops

    Returns:
        Tuple of (path, termination_reason) where:
        - path is list of (position, original_cell) tuples
        - termination_reason indicates why traversal stopped
    """
    # Direction deltas: N=up, S=down, E=right, W=left
    deltas = {
        Direction.N: (-1, 0),
        Direction.S: (1, 0),
        Direction.E: (0, 1),
        Direction.W: (0, -1),
    }

    path: list[tuple[CellPosition, Cell]] = []
    visited: set[tuple[str, int, int]] = set()
    current = start
    depth = 0

    # Add starting position to path
    start_cell = get_cell(store, start)

    # Check if starting cell has stop tag
    if tag_fn is not None:
        tags = tag_fn(start_cell)
        if "stop" in tags:
            return ([], TerminationReason.STOP_TAG)

    path.append((start, start_cell))
    visited.add((start.grid_id, start.row, start.col))

    while depth < max_depth:
        depth += 1

        # Get current grid and compute next position
        grid = store[current.grid_id]
        dr, dc = deltas[direction]
        next_row, next_col = current.row + dr, current.col + dc

        # Check if we hit an edge
        if next_row < 0 or next_row >= grid.rows or next_col < 0 or next_col >= grid.cols:
            # At edge - need to exit to parent grid
            primary_ref = find_primary_ref(store, current.grid_id)

            if primary_ref is None:
                # No parent - we're at the root grid edge
                return (path, TerminationReason.EDGE_REACHED)

            # Exit through the primary ref
            parent_grid_id, parent_row, parent_col = primary_ref
            parent_grid = store[parent_grid_id]

            # Continue from the primary ref's position in parent grid
            next_row = parent_row + dr
            next_col = parent_col + dc

            # Check if we're still at edge after exiting
            if (
                next_row < 0
                or next_row >= parent_grid.rows
                or next_col < 0
                or next_col >= parent_grid.cols
            ):
                # Cascading exit - use exit chain logic
                exit_pos = CellPosition(parent_grid_id, parent_row, parent_col)
                final_pos, hit_cycle = _follow_exit_chain(
                    store, exit_pos, direction, rules, max_depth - depth
                )

                if final_pos is None:
                    # Exited root grid
                    return (path, TerminationReason.EDGE_REACHED)

                if hit_cycle:
                    return (path, TerminationReason.EXIT_CYCLE_DETECTED)

                # Continue from final exit position
                current = final_pos
                next_grid = store[current.grid_id]
                next_row = current.row + dr
                next_col = current.col + dc

                # Check edge again after exit chain
                if (
                    next_row < 0
                    or next_row >= next_grid.rows
                    or next_col < 0
                    or next_col >= next_grid.cols
                ):
                    return (path, TerminationReason.EDGE_REACHED)

                current = CellPosition(current.grid_id, next_row, next_col)
            else:
                # Normal exit to parent
                current = CellPosition(parent_grid_id, next_row, next_col)
        else:
            # Normal move within same grid
            current = CellPosition(current.grid_id, next_row, next_col)

        # Check for cycle
        key = (current.grid_id, current.row, current.col)
        if key in visited:
            # Check if we cycled back to start (success) or elsewhere (failure)
            if current == start:
                # Cycle to start - success condition for push
                return (path, TerminationReason.PATH_CYCLE_DETECTED)
            else:
                # Invalid cycle to non-start position
                return (path, TerminationReason.PATH_CYCLE_DETECTED)

        # Get the cell at current position
        cell = get_cell(store, current)

        # Check for stop tag
        if tag_fn is not None:
            tags = tag_fn(cell)
            if "stop" in tags:
                return (path, TerminationReason.STOP_TAG)

        # Handle Ref cells with portal/solid logic based on rule set
        if isinstance(cell, Ref):
            if rules.ref_strategy == RefStrategy.PUSH_FIRST:
                # PUSH_FIRST: Ref acts as SOLID object immediately
                path.append((current, cell))
                visited.add(key)
            else:
                # TRY_ENTER_FIRST: Try to enter the referenced grid first
                entry_pos = try_enter(store, cell.grid_id, direction, rules)

                if entry_pos is None:
                    # Entry denied - Ref acts as SOLID object
                    path.append((current, cell))
                    visited.add(key)
                else:
                    # Entry allowed - Ref acts as PORTAL
                    # Follow the enter chain to find final non-Ref destination
                    final_pos, hit_cycle = _follow_enter_chain(
                        store, entry_pos, direction, rules, max_depth - depth
                    )

                    if final_pos is None:
                        # try_enter denied mid-chain
                        return (path, TerminationReason.ENTRY_DENIED)

                    if hit_cycle:
                        return (path, TerminationReason.ENTRY_CYCLE_DETECTED)

                    # Continue from the final position after entering
                    current = final_pos
                    # Don't add the Ref to the path - it's a portal
                    # Get the final destination cell
                    final_cell = get_cell(store, current)

                    # Check for stop tag on the final cell after following the chain
                    if tag_fn is not None:
                        tags = tag_fn(final_cell)
                        if "stop" in tags:
                            return (path, TerminationReason.STOP_TAG)

                    # Add the final destination to path and visited
                    path.append((current, final_cell))
                    visited.add((current.grid_id, current.row, current.col))

                    # Check if we just added an Empty cell - if so, push succeeds
                    if isinstance(final_cell, Empty):
                        return (path, TerminationReason.EDGE_REACHED)
        else:
            # Non-Ref cell - add to path and continue
            path.append((current, cell))
            visited.add(key)

            # Check if we just added an Empty cell - if so, push succeeds
            if isinstance(cell, Empty):
                return (path, TerminationReason.EDGE_REACHED)

    # Exceeded max_depth
    return (path, TerminationReason.MAX_DEPTH_REACHED)


def push_traverse_backtracking(
    store: GridStore,
    start: CellPosition,
    direction: Direction,
    rules: RuleSet,
    tag_fn: TagFn | None = None,
    max_depth: int = 1000,
    max_backtrack_depth: int = 10,
) -> tuple[list[tuple[CellPosition, Cell]], TerminationReason]:
    """
    Traversal with backtracking for push operation.

    When push fails with the initial Ref handling strategy, backtracks to that
    decision point and retries with the alternative strategy.

    Ref handling governed by rule set:
    - If ref_strategy=TRY_ENTER_FIRST: Try portal first, backtrack tries solid
    - If ref_strategy=PUSH_FIRST: Try solid first, backtrack tries portal
    - On failure: backtrack and retry with alternative strategy

    Args:
        store: The grid store containing all grids
        start: Starting position
        direction: Direction to traverse
        rules: RuleSet governing Ref handling behavior
        tag_fn: Optional function to tag cells (e.g., for 'stop' tag)
        max_depth: Maximum number of steps to prevent infinite loops
        max_backtrack_depth: Maximum number of backtracking attempts

    Returns:
        Tuple of (path, termination_reason) where:
        - path is list of (position, original_cell) tuples
        - termination_reason indicates why traversal stopped
    """
    # Direction deltas: N=up, S=down, E=right, W=left
    deltas = {
        Direction.N: (-1, 0),
        Direction.S: (1, 0),
        Direction.E: (0, 1),
        Direction.W: (0, -1),
    }

    # Initialize state
    path: list[tuple[CellPosition, Cell]] = []
    visited: set[tuple[str, int, int]] = set()
    decision_stack: list[DecisionPoint] = []
    # Track Refs that should use alternative strategy after backtracking
    # Maps (grid_id, row, col) -> "portal" or "solid"
    alternative_strategy_refs: dict[tuple[str, int, int], str] = {}
    current = start
    depth = 0
    backtrack_count = 0
    skip_movement = False  # Flag to skip movement after backtracking

    # Add starting position to path
    start_cell = get_cell(store, start)

    # Check if starting cell has stop tag
    if tag_fn is not None:
        tags = tag_fn(start_cell)
        if "stop" in tags:
            return ([], TerminationReason.STOP_TAG)

    path.append((start, start_cell))
    visited.add((start.grid_id, start.row, start.col))

    while depth < max_depth:
        depth += 1

        # After backtracking, we're positioned at the Ref to retry
        # Skip movement to reprocess the current cell with alternative strategy
        if not skip_movement:
            # Normal flow: compute next position and handle edge cases
            # Get current grid and compute next position
            grid = store[current.grid_id]
            dr, dc = deltas[direction]
            next_row, next_col = current.row + dr, current.col + dc

            # Check if we hit an edge
            if next_row < 0 or next_row >= grid.rows or next_col < 0 or next_col >= grid.cols:
                # At edge - need to exit to parent grid
                primary_ref = find_primary_ref(store, current.grid_id)

                if primary_ref is None:
                    # No parent - we're at the root grid edge
                    return (path, TerminationReason.EDGE_REACHED)

                # Exit through the primary ref
                parent_grid_id, parent_row, parent_col = primary_ref
                parent_grid = store[parent_grid_id]

                # Continue from the primary ref's position in parent grid
                next_row = parent_row + dr
                next_col = parent_col + dc

                # Check if we're still at edge after exiting
                if (
                    next_row < 0
                    or next_row >= parent_grid.rows
                    or next_col < 0
                    or next_col >= parent_grid.cols
                ):
                    # Cascading exit - use exit chain logic
                    exit_pos = CellPosition(parent_grid_id, parent_row, parent_col)
                    final_pos, hit_cycle = _follow_exit_chain(
                        store, exit_pos, direction, rules, max_depth - depth
                    )

                    if final_pos is None:
                        # Exited root grid
                        return (path, TerminationReason.EDGE_REACHED)

                    if hit_cycle:
                        # Try to backtrack
                        if decision_stack and backtrack_count < max_backtrack_depth:
                            backtrack_count += 1
                            decision = decision_stack.pop()
                            current, path, visited, depth = _restore_from_decision(decision, alternative_strategy_refs)
                            skip_movement = True
                            # Continue - will retry with alternative strategy
                            continue
                        else:
                            return (path, TerminationReason.EXIT_CYCLE_DETECTED)

                    # Continue from final exit position
                    current = final_pos
                    next_grid = store[current.grid_id]
                    next_row = current.row + dr
                    next_col = current.col + dc

                    # Check edge again after exit chain
                    if (
                        next_row < 0
                        or next_row >= next_grid.rows
                        or next_col < 0
                        or next_col >= next_grid.cols
                    ):
                        return (path, TerminationReason.EDGE_REACHED)

                    current = CellPosition(current.grid_id, next_row, next_col)
                else:
                    # Normal exit to parent
                    current = CellPosition(parent_grid_id, next_row, next_col)
            else:
                # Normal move within same grid
                current = CellPosition(current.grid_id, next_row, next_col)
        else:
            # After backtracking: reprocess current position (the Ref) with alternative strategy
            skip_movement = False

        # Check for cycle
        key = (current.grid_id, current.row, current.col)
        if key in visited:
            # Check if we cycled back to start (success) or elsewhere (failure)
            if current == start:
                # Cycle to start - success condition for push
                return (path, TerminationReason.PATH_CYCLE_DETECTED)
            else:
                # Invalid cycle to non-start position - try to backtrack
                if decision_stack and backtrack_count < max_backtrack_depth:
                    backtrack_count += 1
                    decision = decision_stack.pop()
                    current, path, visited, depth = _restore_from_decision(decision, alternative_strategy_refs)
                    skip_movement = True
                    # Continue - will retry with alternative strategy
                    continue
                else:
                    return (path, TerminationReason.PATH_CYCLE_DETECTED)

        # Get the cell at current position
        cell = get_cell(store, current)

        # Check for stop tag
        if tag_fn is not None:
            tags = tag_fn(cell)
            if "stop" in tags:
                # Hit stop tag - try to backtrack
                if decision_stack and backtrack_count < max_backtrack_depth:
                    backtrack_count += 1
                    decision = decision_stack.pop()
                    current, path, visited, depth = _restore_from_decision(decision, alternative_strategy_refs)
                    skip_movement = True
                    # Continue - will retry with alternative strategy
                    continue
                else:
                    return (path, TerminationReason.STOP_TAG)

        # Handle Ref cells with portal/solid logic + backtracking
        if isinstance(cell, Ref):
            ref_key = (current.grid_id, current.row, current.col)

            # Determine which strategy to use for this Ref
            if ref_key in alternative_strategy_refs:
                # Use alternative strategy from previous backtrack
                strategy = alternative_strategy_refs[ref_key]
            else:
                # Use default strategy from rule set
                strategy = "portal" if rules.ref_strategy == RefStrategy.TRY_ENTER_FIRST else "solid"

            if strategy == "portal":
                # Try to enter the referenced grid (portal behavior)
                entry_pos = try_enter(store, cell.grid_id, direction, rules)

                if entry_pos is not None:
                    # Entry allowed - create decision point for potential backtracking
                    decision = DecisionPoint(
                        ref_position=current,
                        ref_cell=cell,
                        path_snapshot=path.copy(),
                        visited_snapshot=visited.copy(),
                        depth_at_decision=depth,
                        strategy_used="portal",
                    )
                    decision_stack.append(decision)

                    # Follow the enter chain to find final non-Ref destination
                    final_pos, hit_cycle = _follow_enter_chain(
                        store, entry_pos, direction, rules, max_depth - depth
                    )

                    if final_pos is None:
                        # try_enter denied mid-chain - backtrack
                        if backtrack_count < max_backtrack_depth:
                            backtrack_count += 1
                            decision = decision_stack.pop()
                            current, path, visited, depth = _restore_from_decision(decision, alternative_strategy_refs)
                            skip_movement = True
                            # Continue - will retry with alternative strategy
                            continue
                        else:
                            return (path, TerminationReason.ENTRY_DENIED)

                    if hit_cycle:
                        # Cycle in enter chain - backtrack
                        if backtrack_count < max_backtrack_depth:
                            backtrack_count += 1
                            decision = decision_stack.pop()
                            current, path, visited, depth = _restore_from_decision(decision, alternative_strategy_refs)
                            skip_movement = True
                            # Continue - will retry with alternative strategy
                            continue
                        else:
                            return (path, TerminationReason.ENTRY_CYCLE_DETECTED)

                    # Successfully entered - continue from the final position
                    current = final_pos
                    # Don't add the Ref to the path - it's a portal
                    # Get the final destination cell
                    final_cell = get_cell(store, current)

                    # Check for stop tag on the final cell after following the chain
                    if tag_fn is not None:
                        tags = tag_fn(final_cell)
                        if "stop" in tags:
                            # Hit stop tag after entering - try to backtrack
                            if backtrack_count < max_backtrack_depth:
                                backtrack_count += 1
                                decision = decision_stack.pop()
                                current, path, visited, depth = _restore_from_decision(decision, alternative_strategy_refs)
                                skip_movement = True
                                # Continue - will retry with alternative strategy
                                continue
                            else:
                                return (path, TerminationReason.STOP_TAG)

                    # Add the final destination to path and visited
                    path.append((current, final_cell))
                    visited.add((current.grid_id, current.row, current.col))

                    # Check if we just added an Empty cell - if so, push succeeds
                    if isinstance(final_cell, Empty):
                        return (path, TerminationReason.EDGE_REACHED)
                else:
                    # Entry denied - Ref acts as SOLID object (no decision point)
                    path.append((current, cell))
                    visited.add(ref_key)
            else:
                # strategy == "solid": Ref acts as SOLID object
                # Create decision point in case we need to backtrack and try portal
                decision = DecisionPoint(
                    ref_position=current,
                    ref_cell=cell,
                    path_snapshot=path.copy(),
                    visited_snapshot=visited.copy(),
                    depth_at_decision=depth,
                    strategy_used="solid",
                )
                decision_stack.append(decision)

                # Add Ref to path as solid object
                path.append((current, cell))
                visited.add(ref_key)
        else:
            # Non-Ref cell - add to path and continue
            path.append((current, cell))
            visited.add(key)

            # Check if we just added an Empty cell - if so, push succeeds
            if isinstance(cell, Empty):
                return (path, TerminationReason.EDGE_REACHED)

    # Exceeded max_depth - try to backtrack
    if decision_stack and backtrack_count < max_backtrack_depth:
        backtrack_count += 1
        decision = decision_stack.pop()
        current, path, visited, depth = _restore_from_decision(decision, alternative_strategy_refs)
        skip_movement = True
        # Continue the loop (but this shouldn't really happen with proper depth tracking)
        return push_traverse_backtracking(store, start, direction, try_enter, rules, tag_fn, max_depth, max_backtrack_depth)
    else:
        return (path, TerminationReason.MAX_DEPTH_REACHED)


def apply_push(
    store: GridStore,
    path: list[tuple[CellPosition, Cell]],
) -> GridStore:
    """
    Apply a push operation by rotating cell contents along the path.

    Rotates cells forward: the last cell's content moves to the first position,
    and all other cells shift forward by one position.

    Args:
        store: The grid store containing all grids
        path: List of (position, original_cell) tuples representing the push path

    Returns:
        New GridStore with updated grids (original store unchanged)
    """
    from collections import defaultdict

    # Extract cells and rotate: [c1, c2, c3] -> [c3, c1, c2]
    cells = [cell for _, cell in path]
    rotated = [cells[-1]] + cells[:-1]

    # Group updates by grid_id: grid_id -> list of (row, col, new_cell)
    updates: dict[str, list[tuple[int, int, Cell]]] = defaultdict(list)
    for i, (pos, _) in enumerate(path):
        updates[pos.grid_id].append((pos.row, pos.col, rotated[i]))

    # Reconstruct affected grids immutably
    new_store = store.copy()
    for grid_id, grid_updates in updates.items():
        grid = store[grid_id]

        # Convert to mutable structure
        mutable_cells = [list(row) for row in grid.cells]

        # Apply all updates for this grid
        for row, col, new_cell in grid_updates:
            mutable_cells[row][col] = new_cell

        # Convert back to immutable tuples
        new_cells = tuple(tuple(row) for row in mutable_cells)

        # Create new Grid instance
        new_grid = Grid(grid.id, new_cells)
        new_store[grid_id] = new_grid

    return new_store


# =============================================================================
# Phase 2: Render (ASCII)
# =============================================================================


def collect_denominators(node: CellNode) -> set[int]:
    """Collect all denominators from nested grid dimensions.

    Tracks visited grids to prevent infinite recursion on cyclic references.
    """
    denoms: set[int] = set()
    visited_grids: set[str] = set()

    def walk(n: CellNode, w: Fraction, h: Fraction) -> None:
        if isinstance(n, NestedNode):
            # Check if we've already visited this grid
            if n.grid_id in visited_grids:
                return
            visited_grids.add(n.grid_id)

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
        elif isinstance(n, RefNode):
            # Just walk the content - the NestedNode inside will handle cycle detection
            walk(n.content, w, h)

    walk(node, Fraction(1), Fraction(1))
    return denoms


def compute_scale(node: CellNode, max_scale: int = 10000) -> tuple[int, int]:
    """
    Compute character dimensions that give exact integer cell sizes.

    Args:
        node: The cell tree to compute scale for
        max_scale: Maximum scale to prevent excessive memory usage (default 10000)

    Returns:
        Tuple of (width, height) in characters
    """
    denoms = collect_denominators(node)
    if not denoms:
        return (1, 1)
    scale = 1
    capped = False
    for d in denoms:
        new_scale = lcm(scale, d)
        if new_scale > max_scale:
            # Stop growing - use current scale
            capped = True
            break
        scale = new_scale

    logger.info(
        "compute_scale: common denominator=%d, capped=%s (max_scale=%d)",
        scale,
        capped,
        max_scale,
    )
    return (scale, scale)


def render_to_buffer(
    node: CellNode,
    buffer: list[list[str]],
    x: int,
    y: int,
    w: int,
    h: int,
    color_fn: Callable[[str], Callable[[str], str]],
    parent_grid_id: str | None = None,
    highlight_pos: CellPosition | None = None,
    current_grid_id: str | None = None,
    current_row: int | None = None,
    current_col: int | None = None,
) -> None:
    """Render a CellNode into a character buffer at the given position."""
    if w <= 0 or h <= 0:
        return

    # Check if this cell should be highlighted
    is_highlighted = (
        highlight_pos is not None
        and current_grid_id == highlight_pos.grid_id
        and current_row == highlight_pos.row
        and current_col == highlight_pos.col
    )

    match node:
        case EmptyNode():
            # Draw border with dash (explicitly empty), colored by parent grid
            if is_highlighted:
                colorize = chalk.white
            else:
                colorize = color_fn(parent_grid_id) if parent_grid_id else lambda s: s
            char = colorize("-")
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

        case CutoffNode():
            # Fill with dash (below threshold, had more content), colored by parent grid
            if is_highlighted:
                colorize = chalk.white
            else:
                colorize = color_fn(parent_grid_id) if parent_grid_id else lambda s: s
            char = colorize("-")
            for row in range(y, y + h):
                for col in range(x, x + w):
                    buffer[row][col] = char

        case ConcreteNode(id=cell_id, grid_id=gid):
            base_char = cell_id[0] if cell_id else "?"
            if is_highlighted:
                colorize = chalk.white
            else:
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

        case RefNode(grid_id=gid, ref_target=ref_target, is_primary=is_primary, content=content):
            # Render the content first
            render_to_buffer(
                content, buffer, x, y, w, h, color_fn, gid,
                highlight_pos, current_grid_id, current_row, current_col
            )

            # For primary refs, fill interior with dots matching the referenced grid's color
            if is_primary and w >= 3 and h >= 3:
                colorize = color_fn(ref_target)
                dot_char = colorize(".")
                for row in range(y + 1, y + h - 1):
                    for col in range(x + 1, x + w - 1):
                        if buffer[row][col] == " ":
                            buffer[row][col] = dot_char

        case NestedNode(grid_id=gid, children=children):
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
                        gid,  # Pass grid_id as parent context
                        highlight_pos,
                        gid,  # Current grid_id for this cell
                        r_idx,  # Current row
                        c_idx,  # Current col
                    )


def collect_grid_ids(node: CellNode) -> set[str]:
    """Collect all grid IDs from the tree."""
    ids: set[str] = set()

    def walk(n: CellNode) -> None:
        if isinstance(n, ConcreteNode):
            ids.add(n.grid_id)
        elif isinstance(n, RefNode):
            ids.add(n.grid_id)  # Add the grid containing the ref
            walk(n.content)  # Walk the content
        elif isinstance(n, NestedNode):
            ids.add(n.grid_id)  # Add the nested grid id
            for row in n.children:
                for child in row:
                    walk(child)

    walk(node)
    return ids


def render(node: CellNode, max_scale: int = 10000, highlight_pos: CellPosition | None = None) -> str:
    """
    Render a CellTree to an ASCII string with colors.

    Args:
        node: The cell tree to render
        max_scale: Maximum scale for rendering (default 10000)
        highlight_pos: Optional cell position to highlight in white

    Returns:
        Rendered ASCII string with ANSI color codes
    """
    char_w, char_h = compute_scale(node, max_scale)

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
    render_to_buffer(node, buffer, 0, 0, char_w, char_h, color_fn, highlight_pos=highlight_pos)

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
    parent_grid_id: str | None = None,
) -> None:
    """Render a CellNode into a character buffer with visit numbers overlaid."""
    if w <= 0 or h <= 0:
        return

    match node:
        case EmptyNode():
            # Draw border with dash (explicitly empty), colored by parent grid
            colorize = color_fn(parent_grid_id) if parent_grid_id else lambda s: s
            char = colorize("-")
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

        case CutoffNode():
            # Fill with dash (below threshold, had more content), colored by parent grid
            colorize = color_fn(parent_grid_id) if parent_grid_id else lambda s: s
            char = colorize("-")
            for row in range(y, y + h):
                for col in range(x, x + w):
                    buffer[row][col] = char

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

        case RefNode(grid_id=gid, ref_target=ref_target, is_primary=is_primary, content=content):
            # Render the content first
            render_to_buffer_with_visits(content, buffer, x, y, w, h, color_fn, visit_map, gid)

            # For primary refs, fill interior with dots matching the referenced grid's color
            if is_primary and w >= 3 and h >= 3:
                colorize = color_fn(ref_target)
                dot_char = colorize(".")
                for row in range(y + 1, y + h - 1):
                    for col in range(x + 1, x + w - 1):
                        # Don't overwrite visit numbers (non-space characters other than dots)
                        if buffer[row][col] == " ":
                            buffer[row][col] = dot_char

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
                        gid,  # Pass grid_id as parent context
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

