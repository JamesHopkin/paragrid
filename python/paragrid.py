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
from typing import Callable, Iterator, Union, assert_never

from depth_aware_entry import (
    calculate_exit_fraction,
    calculate_entry_position_equivalent_point,
    calculate_standard_entry_position,
    should_use_equivalent_point,
)
from grid_types import Direction

logger = logging.getLogger(__name__)

# Configuration: Sanity check limit for backtracking to prevent hangs
# Should never be reached in practice with finite grids
MAX_BACKTRACK_DEPTH = 10000

# Public API
__all__ = [
    # Imported from grid_types
    "Direction",
    # Strategy types
    "RefStrategyType",
    "RefStrategy",
    "RuleSet",
    # Cell types
    "Empty",
    "Concrete",
    "Ref",
    "Cell",
    # Grid types
    "Grid",
    "GridStore",
    # Node types
    "EmptyNode",
    "CutoffNode",
    "ConcreteNode",
    "NestedNode",
    "RefNode",
    "CellNode",
    # Position and tags
    "CellPosition",
    "TagFn",
    # Failure types
    "PushFailure",
    # Functions
    "analyze",
    "parse_grids",
    "push",
    "pull",
    "push_simple",
    "find_primary_ref",
    "find_tagged_cell",
]


class RefStrategyType(Enum):
    """Individual strategy types for handling Ref cells."""

    PORTAL = "portal"  # Try to enter the Ref (traverse through it)
    SOLID = "solid"  # Treat the Ref as a solid object (push it)
    SWALLOW = "swallow"  # Swallow the target cell (only when start is Ref)


# Type alias for ref strategy ordering
RefStrategyOrder = tuple[RefStrategyType, ...]

# Predefined common strategy orderings
class RefStrategy:
    """Common Ref handling strategy orderings."""

    # Default: try solid (push), then portal (enter), then swallow
    DEFAULT: RefStrategyOrder = (
        RefStrategyType.SOLID,
        RefStrategyType.PORTAL,
        RefStrategyType.SWALLOW,
    )

    # Legacy compatibility
    TRY_ENTER_FIRST: RefStrategyOrder = (
        RefStrategyType.PORTAL,
        RefStrategyType.SOLID,
        RefStrategyType.SWALLOW,
    )

    PUSH_FIRST: RefStrategyOrder = (
        RefStrategyType.SOLID,
        RefStrategyType.PORTAL,
        RefStrategyType.SWALLOW,
    )

    SWALLOW_FIRST: RefStrategyOrder = (
        RefStrategyType.SWALLOW,
        RefStrategyType.PORTAL,
        RefStrategyType.SOLID,
    )


@dataclass(frozen=True)
class RuleSet:
    """Rules governing operation behavior."""

    ref_strategy: RefStrategyOrder = RefStrategy.DEFAULT


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

    focus_depth: int | None = None
    focus_offset: tuple[int, int] | None = None


@dataclass(frozen=True)
class CutoffNode:
    """Cell below recursion threshold (had more content)."""

    focus_depth: int | None = None
    focus_offset: tuple[int, int] | None = None


@dataclass(frozen=True)
class ConcreteNode:
    """Analyzed concrete cell."""

    id: str
    grid_id: str  # Which grid this cell belongs to
    focus_depth: int | None = None
    focus_offset: tuple[int, int] | None = None


@dataclass(frozen=True)
class NestedNode:
    """Analyzed nested grid."""

    grid_id: str
    children: tuple[tuple[CellNode, ...], ...]
    focus_depth: int | None = None
    focus_offset: tuple[int, int] | None = None


@dataclass(frozen=True)
class RefNode:
    """A reference to another grid (wraps the nested content)."""

    grid_id: str  # The grid this ref belongs to
    ref_target: str  # The grid being referenced
    is_primary: bool  # Whether this is the primary reference
    content: "CellNode"  # The analyzed content of the referenced grid
    focus_depth: int | None = None
    focus_offset: tuple[int, int] | None = None


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
    focus_path: list[str] | None = None,
    current_path: list[str] | None = None,
    parent_ref_pos: tuple[int, int] | None = None,
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
        focus_path: Optional path to the focused grid (list of grid IDs)
        current_path: Current path during traversal (list of grid IDs)
        parent_ref_pos: Position of the ref cell in the parent grid (for depth -1 offset)
    """
    if primary_refs is None:
        primary_refs = set()

    # Initialize current path if not provided
    if current_path is None:
        current_path = [grid_id]
    else:
        current_path = current_path + [grid_id]

    # Helper function to find ref position for depth -1 offset computation
    def find_focus_ref_position() -> tuple[int, int] | None:
        """Find the position of the ref cell that leads toward the focused grid."""
        # Invariant: current_path is always initialized (lines 321-324)
        # focus_path is checked by caller (compute_focus_metadata line 348)
        assert focus_path is not None and current_path is not None, "unreachable: paths initialized before helper call"
        if len(current_path) >= len(focus_path):
            return None
        if focus_path[: len(current_path)] != current_path:
            return None
        # We're an ancestor - find the ref to the next grid in focus_path
        next_grid_id = focus_path[len(current_path)]
        for r, row in enumerate(grid.cells):
            for c, cell in enumerate(row):
                if isinstance(cell, Ref) and cell.grid_id == next_grid_id:
                    return (c, r)
        return None

    # Helper function to compute focus metadata
    def compute_focus_metadata(
        row: int, col: int
    ) -> tuple[int | None, tuple[int, int] | None]:
        """Compute focus_depth and focus_offset for a cell at (row, col)."""
        if focus_path is None:
            return None, None

        # Compare current_path to focus_path
        if current_path == focus_path:
            # Depth 0: inside focused grid
            return 0, (col, row)
        elif len(current_path) < len(focus_path):
            # Check if current_path is a prefix of focus_path
            if focus_path[: len(current_path)] == current_path:
                # We're an ancestor (negative depth)
                depth = -(len(focus_path) - len(current_path))
                # For any ancestor level, compute offset relative to ref position
                ref_pos = find_focus_ref_position()
                if ref_pos is not None:
                    ref_col, ref_row = ref_pos
                    return depth, (col - ref_col, row - ref_row)
                return depth, None
        elif len(current_path) > len(focus_path):
            # Check if focus_path is a prefix of current_path
            if current_path[: len(focus_path)] == focus_path:
                # We're a descendant (positive depth)
                depth = len(current_path) - len(focus_path)
                return depth, None

        # Paths diverged
        return None, None

    if width < threshold or height < threshold:
        depth, offset = compute_focus_metadata(0, 0)
        return CutoffNode(depth, offset)

    grid = store[grid_id]
    cell_width = width / grid.cols
    cell_height = height / grid.rows

    rows: list[tuple[CellNode, ...]] = []
    for r, row in enumerate(grid.cells):
        cols: list[CellNode] = []
        for c, cell in enumerate(row):
            # Compute focus metadata for this cell
            depth, offset = compute_focus_metadata(r, c)

            match cell:
                case Empty():
                    cols.append(EmptyNode(depth, offset))
                case Concrete(id=cell_id):
                    cols.append(ConcreteNode(cell_id, grid_id, depth, offset))
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
                    content = analyze(
                        store,
                        ref_id,
                        cell_width,
                        cell_height,
                        threshold,
                        primary_refs,
                        focus_path,
                        current_path,
                        (c, r),  # Pass ref position for depth -1 offset
                    )

                    # Wrap in RefNode
                    cols.append(RefNode(grid_id, ref_id, is_primary, content, depth, offset))
                case _: # pragma: no cover
                    assert_never(cell)
        rows.append(tuple(cols))

    # Compute focus metadata for the NestedNode itself
    # NestedNode represents the entire grid - use position (0, 0) as representative
    depth, offset = compute_focus_metadata(0, 0)

    return NestedNode(grid_id, tuple(rows), depth, offset)


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


class Navigator:
    """
    Stateful navigator through grid positions in a direction.

    Handles grid traversal with automatic edge detection and entry/exit logic.
    Based on the reference implementation in test_push_sketch.py.
    """

    def __init__(
        self,
        store: GridStore,
        position: CellPosition,
        direction: Direction,
    ):
        self.store = store
        self.current = position
        self.direction = direction
        self.visited_grids: set[str] = set()  # For exit cycle detection

        # Depth-aware entry tracking
        self.depth: int = 0  # enters - exits
        self.exit_position: tuple[int, int] | None = None  # (row, col) when last exit occurred
        self.exit_depth: int | None = None  # depth at which last exit occurred
        self.exit_fraction: float | None = None  # fractional position (0.0-1.0) along edge when exiting

        # Direction deltas
        self.deltas = {
            Direction.N: (-1, 0),
            Direction.S: (1, 0),
            Direction.E: (0, 1),
            Direction.W: (0, -1),
        }

    def clone(self) -> "Navigator":
        """Create a copy for backtracking."""
        nav = Navigator(self.store, self.current, self.direction)
        nav.visited_grids = self.visited_grids.copy()
        # Copy depth tracking state
        nav.depth = self.depth
        nav.exit_position = self.exit_position
        nav.exit_depth = self.exit_depth
        nav.exit_fraction = self.exit_fraction
        return nav

    def try_advance(self) -> bool:
        """
        Try to move to next position in direction.
        Handles exiting from nested grids back to parent grids.
        Returns False if can't advance (hit root edge or exit cycle).
        Clears visited_grids on any advance.
        """
        # Clear visited grids when advancing
        self.visited_grids.clear()

        dr, dc = self.deltas[self.direction]
        grid = self.store[self.current.grid_id]
        next_row = self.current.row + dr
        next_col = self.current.col + dc

        # Check bounds
        if next_row < 0 or next_row >= grid.rows or next_col < 0 or next_col >= grid.cols:
            # Hit edge - try to exit through cascading parent grids
            # Capture exit position and fractional position for depth-aware entry
            self.exit_position = (self.current.row, self.current.col)
            self.exit_depth = self.depth
            self.exit_fraction = calculate_exit_fraction(
                self.direction,
                self.current.row,
                self.current.col,
                grid.rows,
                grid.cols,
            )

            # Use iterative approach with cycle detection
            visited_exit_positions: set[tuple[str, int, int]] = set()
            current_grid_id = self.current.grid_id

            while True:
                primary_ref = find_primary_ref(self.store, current_grid_id)
                if primary_ref is None:
                    return False  # Hit root edge

                # Exit through primary ref - decrement depth
                self.depth -= 1

                parent_grid_id, parent_row, parent_col = primary_ref

                # Detect exit cycle
                exit_key = (parent_grid_id, parent_row, parent_col)
                if exit_key in visited_exit_positions:
                    return False  # Exit cycle detected
                visited_exit_positions.add(exit_key)

                parent_grid = self.store[parent_grid_id]

                # Continue in same direction from primary ref
                exit_row = parent_row + dr
                exit_col = parent_col + dc

                # Check if exit position is valid in parent
                if (
                    exit_row >= 0
                    and exit_row < parent_grid.rows
                    and exit_col >= 0
                    and exit_col < parent_grid.cols
                ):
                    # Successfully exited to valid position
                    self.current = CellPosition(parent_grid_id, exit_row, exit_col)
                    return True

                # Cascading exit - continue from parent
                current_grid_id = parent_grid_id

        self.current = CellPosition(self.current.grid_id, next_row, next_col)
        return True

    def advance(self) -> None:
        """Move to next position in direction. Asserts if can't advance."""
        success = self.try_advance()
        assert success, f"Navigator.advance() failed at {self.current}"

    def try_enter(self, rules: RuleSet) -> bool:
        """
        Try to enter the Ref at current position from the current direction.
        Increments depth on successful entry and passes depth-aware entry parameters.
        Returns False if can't enter.
        """
        cell = get_cell(self.store, self.current)
        assert isinstance(cell, Ref)

        # Pass depth information for depth-aware entry
        entry_pos = enter(
            self.store,
            cell.grid_id,
            self.direction,
            rules,
            current_depth=self.depth + 1,  # What depth will be after entering
            exit_position=self.exit_position,
            exit_depth=self.exit_depth,
            exit_fraction=self.exit_fraction,
        )

        self.visited_grids.add(cell.grid_id)
        self.current = entry_pos
        # Increment depth after successful entry
        self.depth += 1
        return True

    def enter(self, rules: RuleSet) -> None:
        """Enter the Ref at current position. Asserts if can't enter."""
        success = self.try_enter(rules)
        assert success, f"Navigator.enter() failed at {self.current}"

    def flip(self) -> None:
        """Reverse direction for swallow operations."""
        flips = {
            Direction.N: Direction.S,
            Direction.S: Direction.N,
            Direction.E: Direction.W,
            Direction.W: Direction.E,
        }
        self.direction = flips[self.direction]


@dataclass
class State:
    """State for backtracking in push operations."""

    path: list[CellPosition]
    nav: Navigator
    strategies: list[str]
    visited: set[tuple[str, int, int]]  # Track visited positions for cycle detection


@dataclass(frozen=True)
class PushFailure:
    """Information about why a push operation failed."""

    reason: str  # "ENTER_CYCLE" | "EXIT_CYCLE" | "BLOCKED" | "STOP_TAG" | "PATH_CYCLE" | "NO_STRATEGY" | "MAX_DEPTH"
    position: CellPosition  # Where the failure occurred
    details: str | None = None  # Optional human-readable details


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


def enter(
    store: GridStore,
    grid_id: str,
    direction: Direction,
    rules: RuleSet,
    current_depth: int | None = None,
    exit_position: tuple[int, int] | None = None,
    exit_depth: int | None = None,
    exit_fraction: float | None = None,
) -> CellPosition:
    """
    Determine entry point when entering a grid via a Ref.

    Returns the CellPosition to enter at, or None to deny entry.

    Entry Strategy:
    - If current_depth == exit_depth (entering at same depth as last exit):
      Use equivalent point transfer - preserve fractional position along edge
    - Otherwise: Use standard middle-of-edge entry

    Standard Entry Convention:
    - East (from left): (rows // 2, 0) — middle of left edge
    - West (from right): (rows // 2, cols - 1) — middle of right edge
    - South (from top): (0, cols // 2) — middle of top edge
    - North (from bottom): (rows - 1, cols // 2) — middle of bottom edge

    Args:
        store: The grid store containing all grids
        grid_id: ID of the grid to enter
        direction: Direction of entry
        rules: RuleSet governing entry behavior (currently unused)
        current_depth: Current depth (enters - exits), for depth-aware entry
        exit_position: (row, col) of last exit position, for debugging/logging
        exit_depth: Depth at which last exit occurred
        exit_fraction: Fractional position (0.0-1.0) along edge when exiting

    Returns:
        CellPosition for entry point, or None to deny entry
    """
    # Get the target grid
    assert grid_id in store

    grid = store[grid_id]
    rows = grid.rows
    cols = grid.cols

    # Check if we should use depth-aware equivalent point transfer
    if should_use_equivalent_point(current_depth, exit_depth, exit_fraction):
        # Use equivalent point transfer - preserve fractional position
        assert exit_fraction is not None  # Type narrowing: guaranteed by should_use_equivalent_point
        entry_row, entry_col = calculate_entry_position_equivalent_point(
            direction, exit_fraction, rows, cols
        )
        return CellPosition(grid_id, entry_row, entry_col)

    # Standard middle-of-edge entry
    entry_row, entry_col = calculate_standard_entry_position(direction, rows, cols)
    return CellPosition(grid_id, entry_row, entry_col)

def push(
    store: GridStore,
    start: CellPosition,
    direction: Direction,
    rules: RuleSet,
    tag_fn: TagFn | None = None,
    max_depth: int = 1000,
) -> GridStore | PushFailure:
    """
    Push cell contents along a path in the given direction (with backtracking).

    The push operation moves cell contents forward along a path, with the contents
    rotating when the push succeeds. Success occurs when:
    1. The path ends at an Empty cell, OR
    2. The path cycles back to the starting position

    This implementation is based on the reference algorithm in test_push_sketch.py,
    using a Navigator abstraction and decision stack for backtracking.

    Args:
        store: The grid store containing all grids
        start: Starting position for the push
        direction: Direction to push
        rules: RuleSet governing Ref handling behavior
        tag_fn: Optional function to tag cells (e.g., for 'stop' tag)
        max_depth: Maximum traversal depth to prevent infinite loops

    Returns:
        New GridStore with pushed contents if successful, PushFailure with reason if push fails
    """

    def strategy_to_str(strat: RefStrategyType) -> str:
        """Convert RefStrategyType to string for internal use."""
        if strat == RefStrategyType.PORTAL:
            return "enter"
        elif strat == RefStrategyType.SOLID:
            return "solid"
        elif strat == RefStrategyType.SWALLOW:
            return "swallow"
        else:  # pragma: no cover
            # Unreachable: RefStrategyType enum only has PORTAL/SOLID/SWALLOW
            assert_never(strat)

    def make_new_state(
        path: list[CellPosition], nav: Navigator, visited: set[tuple[str, int, int]]
    ) -> State | str | PushFailure:
        """
        Create new state or return termination status.

        Returns 'succeed' if push succeeds, PushFailure if it fails, or a new State
        to continue processing.
        """
        # Check for empty (success)
        current_cell = get_cell(store, nav.current)
        if isinstance(current_cell, Empty):
            return "succeed"

        # Check for stop tag (failure)
        if tag_fn is not None and "stop" in tag_fn(current_cell):
            return PushFailure("STOP_TAG", nav.current, "Encountered stop-tagged cell")

        # Check for cycle
        current_key = (nav.current.grid_id, nav.current.row, nav.current.col)
        if current_key in visited:
            # Cycle detected - check if cycling back to start (success) or elsewhere (failure)
            if len(path) > 0 and nav.current == start:
                return "succeed"  # Cycled to start
            else:
                return PushFailure("PATH_CYCLE", nav.current, "Path cycled to non-start position")

        # Add current position to visited set for this state
        new_visited = visited | {current_key}

        # Compute applicable strategies
        strategies = []

        # Get S (source) and T (target)
        assert path
        S_pos = path[-1]
        S_cell = get_cell(store, S_pos)
        T_cell = current_cell

        # Determine available strategies based on rules order
        for strat_type in rules.ref_strategy:
            strat = strategy_to_str(strat_type)
            if strat == "solid":
                # Check if we can advance (peek ahead)
                test_nav = nav.clone()
                if test_nav.try_advance():
                    strategies.append(strat)  # Only if nav can advance
            elif strat == "enter" and isinstance(T_cell, Ref):
                strategies.append(strat)  # Only if T is Ref
            elif strat == "swallow" and S_cell and isinstance(S_cell, Ref):
                strategies.append(strat)  # Only if S is Ref

        if not strategies:
            return PushFailure("NO_STRATEGY", nav.current, "No applicable strategy available")

        return State(path, nav, strategies, new_visited)

    # Check if starting cell has stop tag - stop-tagged cells cannot be pushed
    start_cell = get_cell(store, start)
    if tag_fn is not None and "stop" in tag_fn(start_cell):
        return PushFailure("STOP_TAG", start, "Cannot push from stop-tagged cell")

    # Initialize navigator
    nav = Navigator(store, start, direction)

    # Initialize with start cell in visited set
    initial_visited = {(start.grid_id, start.row, start.col)}

    # Try to advance to first position
    if not nav.try_advance():
        return PushFailure("BLOCKED", start, "Cannot advance from start position (hit edge)")

    # Create initial state
    state = make_new_state([start], nav, initial_visited)
    if isinstance(state, PushFailure):
        return state  # Failed immediately
    if isinstance(state, str):
        # Immediate success - pushed directly into empty
        final_path: list[tuple[CellPosition, Cell]] = []
        final_path.append((start, get_cell(store, start)))
        final_path.append((nav.current, get_cell(store, nav.current)))
        return apply_push(store, final_path)

    decision_stack = [state]
    backtrack_count = 0
    last_failure: PushFailure | None = None

    while decision_stack:
        state = decision_stack[-1]
        if not state.strategies:
            decision_stack.pop()
            backtrack_count += 1
            # Sanity check: Should never be reached with finite grids
            assert backtrack_count < MAX_BACKTRACK_DEPTH, (  # pragma: no cover
                f"Exceeded backtrack depth limit ({MAX_BACKTRACK_DEPTH}). "
                "This indicates a bug in the push algorithm."
            )
            continue

        # Clone navigator for this attempt
        nav = state.nav.clone()

        # Handle remaining cases by strategy
        strategy = state.strategies.pop(0)

        new_path = state.path[:]
        if strategy == "solid":
            new_path.append(nav.current)
            nav.advance()

        elif strategy == "enter":
            nav.enter(rules)

        elif strategy == "swallow":
            new_path.append(nav.current)
            # Swallow: S (last in path) swallows T (current)
            # Move T into S's referenced grid from opposite direction
            nav.flip()
            nav.advance()
            nav.enter(rules)

        new_state = make_new_state(new_path, nav, state.visited)

        if new_state == "succeed":
            # Build final path with cells for apply_push
            path_with_cells: list[tuple[CellPosition, Cell]] = []
            for pos in new_path:
                path_with_cells.append((pos, get_cell(store, pos)))
            path_with_cells.append((nav.current, get_cell(store, nav.current)))
            return apply_push(store, path_with_cells)
        elif isinstance(new_state, PushFailure):
            # Store failure for potential return if all strategies exhausted
            last_failure = new_state
            continue  # Try next strategy
        elif isinstance(new_state, State):
            decision_stack.append(new_state)
            continue

    # All strategies exhausted - last_failure must have been set
    # (guaranteed by finite grids and backtrack assertion above)
    assert last_failure is not None, "Bug: decision_stack empty but no failure recorded"  # pragma: no cover
    return last_failure


def pull(
    store: GridStore,
    start: CellPosition,
    direction: Direction,
    rules: RuleSet,
    tag_fn: TagFn | None = None,
    max_depth: int = 1000,
) -> GridStore:
    """
    Pull cell contents from direction into start position.

    The pull operation moves cell contents backward along a path, with the contents
    rotating when complete. Always succeeds (may be a no-op).

    Unlike push, pull:
    - Requires start to be Empty (returns unchanged store if not)
    - Always succeeds (never returns failure)
    - Treats stop tags and cycles as successful termination conditions
    - Does not use backtracking (uses first applicable strategy only)
    - Does not support SWALLOW strategy (skip it)

    Args:
        store: The grid store containing all grids
        start: Starting position for the pull (should be Empty)
        direction: Direction to pull FROM
        rules: RuleSet governing Ref handling behavior
        tag_fn: Optional function to tag cells (stop tags end chain successfully)
        max_depth: Maximum traversal depth to prevent infinite loops

    Returns:
        New GridStore with pulled contents (always returns, never None)
    """
    # 1. Validate start is Empty - if not, return unchanged store (no-op)
    start_cell = get_cell(store, start)
    if not isinstance(start_cell, Empty):
        return store

    # 2. Initialize navigator
    nav = Navigator(store, start, direction)
    path: list[CellPosition] = [start]
    visited: set[tuple[str, int, int]] = {(start.grid_id, start.row, start.col)}
    depth = 0

    # 3. Try first advance - if can't, return unchanged (no-op)
    if not nav.try_advance():
        return store

    # 4. Build path until termination condition
    while depth < max_depth:
        depth += 1
        current_cell = get_cell(store, nav.current)

        # TERMINATION CONDITIONS (all succeed):

        # 4a. Hit Empty - end chain successfully
        if isinstance(current_cell, Empty):
            break

        # 4b. Hit stop tag - end chain successfully
        if tag_fn is not None and "stop" in tag_fn(current_cell):
            break

        # 4c. Hit cycle - end chain successfully
        current_key = (nav.current.grid_id, nav.current.row, nav.current.col)
        if current_key in visited:
            break

        visited.add(current_key)

        # 5. Determine first applicable strategy
        strategy = None
        for strat_type in rules.ref_strategy:
            if strat_type == RefStrategyType.SOLID:
                test_nav = nav.clone()
                if test_nav.try_advance():
                    strategy = "solid"
                    break
            elif strat_type == RefStrategyType.PORTAL and isinstance(current_cell, Ref):
                test_nav = nav.clone()
                if test_nav.try_enter(rules):
                    strategy = "portal"
                    break
            # SWALLOW: Skip (doesn't apply to pull)

        # 6. Execute strategy
        if strategy == "solid":
            path.append(nav.current)
            nav.advance()
        elif strategy == "portal":
            # DON'T add Ref position to path (traverse through it)
            nav.enter(rules)
        else:
            # No strategy available - add current cell and stop
            path.append(nav.current)
            break

    # 7. Apply rotation
    if len(path) <= 1:
        return store  # No-op (only start in path)

    return apply_pull(store, path)


def push_simple(
    store: GridStore,
    start: CellPosition,
    direction: Direction,
    rules: RuleSet,
    tag_fn: TagFn | None = None,
    max_depth: int = 1000,
) -> GridStore | PushFailure:
    """
    Simple push operation without backtracking.

    The push operation moves cell contents forward along a path, with the contents
    rotating when the push succeeds. Success occurs when:
    1. The path ends at an Empty cell, OR
    2. The path cycles back to the starting position

    When a push fails with the initial Ref handling strategy, the entire push fails.
    This is the simpler algorithm without backtracking, using only the first applicable
    strategy at each decision point.

    Args:
        store: The grid store containing all grids
        start: Starting position for the push
        direction: Direction to push
        rules: RuleSet governing Ref handling behavior
        tag_fn: Optional function to tag cells (e.g., for 'stop' tag)
        max_depth: Maximum traversal depth to prevent infinite loops

    Returns:
        New GridStore with pushed contents if successful, PushFailure with reason if push fails
    """

    def strategy_to_str(strat: RefStrategyType) -> str:
        """Convert RefStrategyType to string for internal use."""
        if strat == RefStrategyType.PORTAL:
            return "enter"
        elif strat == RefStrategyType.SOLID:
            return "solid"
        elif strat == RefStrategyType.SWALLOW:
            return "swallow"
        else:  # pragma: no cover
            # Unreachable: RefStrategyType enum only has PORTAL/SOLID/SWALLOW
            assert_never(strat)

    # Check if starting cell has stop tag - stop-tagged cells cannot be pushed
    start_cell = get_cell(store, start)
    if tag_fn is not None and "stop" in tag_fn(start_cell):
        return PushFailure("STOP_TAG", start, "Cannot push from stop-tagged cell")

    # Initialize navigator
    nav = Navigator(store, start, direction)
    path: list[CellPosition] = [start]
    visited: set[tuple[str, int, int]] = {(start.grid_id, start.row, start.col)}
    depth = 0

    # Try to advance to first position
    if not nav.try_advance():
        return PushFailure("BLOCKED", start, "Cannot advance from start position (hit edge)")

    while depth < max_depth:
        depth += 1

        # Get current cell
        current_cell = get_cell(store, nav.current)

        # Check for empty (success)
        if isinstance(current_cell, Empty):
            path.append(nav.current)
            # Build final path with cells for apply_push
            final_path: list[tuple[CellPosition, Cell]] = [
                (pos, get_cell(store, pos)) for pos in path
            ]
            return apply_push(store, final_path)

        # Check for stop tag (failure)
        if tag_fn is not None and "stop" in tag_fn(current_cell):
            return PushFailure("STOP_TAG", nav.current, "Encountered stop-tagged cell")

        # Check for cycle
        current_key = (nav.current.grid_id, nav.current.row, nav.current.col)
        if current_key in visited:
            # Cycle detected - check if cycling back to start (success) or elsewhere (failure)
            if nav.current == start:
                path.append(nav.current)
                # Build final path with cells for apply_push
                final_path = [(pos, get_cell(store, pos)) for pos in path]
                return apply_push(store, final_path)
            else:
                return PushFailure("PATH_CYCLE", nav.current, "Path cycled to non-start position")

        visited.add(current_key)

        # Get S (source) and T (target)
        S_pos = path[-1] if path else None
        S_cell = get_cell(store, S_pos) if S_pos else None
        T_cell = current_cell

        # Determine first applicable strategy based on rules order
        selected_strategy = None
        for strat_type in rules.ref_strategy:
            strat = strategy_to_str(strat_type)
            if strat == "solid":
                # Check if we can advance (peek ahead)
                test_nav = nav.clone()
                if test_nav.try_advance():
                    selected_strategy = strat
                    break
            elif strat == "enter" and isinstance(T_cell, Ref):
                selected_strategy = strat
                break
            elif strat == "swallow" and S_cell and isinstance(S_cell, Ref):
                selected_strategy = strat
                break

        if not selected_strategy:
            return PushFailure("NO_STRATEGY", nav.current, "No applicable strategy available")

        # Execute the selected strategy
        if selected_strategy == "solid":
            path.append(nav.current)
            nav.advance()

        elif selected_strategy == "enter":
            nav.enter(rules)

        elif selected_strategy == "swallow":
            path.append(nav.current)
            # Swallow: S (last in path) swallows T (current)
            # Move T into S's referenced grid from opposite direction
            nav.flip()
            nav.advance()
            nav.enter(rules)

    return PushFailure("MAX_DEPTH", nav.current, f"Exceeded maximum depth of {max_depth}")


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


def apply_pull(store: GridStore, path: list[CellPosition]) -> GridStore:
    """
    Apply a pull operation by rotating cell contents along the path.

    Rotates cells: the first cell's content moves to the last position,
    and all other cells shift backward by one position.

    This is the OPPOSITE rotation from push: [c1, c2, c3] -> [c2, c3, c1]
    This maintains the relative order of pulled items, preventing sequences
    from being broken up when pulled through refs or across multiple cells.

    Args:
        store: The grid store containing all grids
        path: List of positions involved in the pull, from Empty start to source

    Returns:
        New GridStore with pulled contents applied
    """
    from collections import defaultdict

    # Extract cells and rotate: [c1, c2, c3] -> [c2, c3, c1]
    # Pull uses opposite rotation from push to maintain order
    cells = [get_cell(store, pos) for pos in path]
    rotated = cells[1:] + [cells[0]]

    # Group updates by grid_id for efficient batch updates
    updates: dict[str, list[tuple[int, int, Cell]]] = defaultdict(list)
    for i, pos in enumerate(path):
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


def find_tagged_cell(
    store: GridStore,
    tag: str,
    tag_fn: TagFn,
) -> CellPosition | None:
    """
    Find the first cell with a specific tag across all grids in the store.

    Iterates through all grids and cells, applying tag_fn to find the first
    cell that contains the specified tag.

    Args:
        store: The grid store to search
        tag: The tag to search for (e.g., "player")
        tag_fn: Function that returns set of tags for a cell

    Returns:
        CellPosition of first tagged cell, or None if not found
    """
    for grid in store.values():
        for row_idx, row in enumerate(grid.cells):
            for col_idx, cell in enumerate(row):
                if tag in tag_fn(cell):
                    return CellPosition(grid.id, row_idx, col_idx)
    return None
