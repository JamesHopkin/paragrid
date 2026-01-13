"""
Test rotation framework for systematic directional testing.

This module provides utilities to write tests once and automatically run them
in all 4 rotations (0°, 90°, 180°, 270°), ensuring comprehensive directional coverage.
"""

from dataclasses import dataclass
from typing import Callable

from paragrid import (
    Cell,
    CellPosition,
    Concrete,
    Direction,
    Empty,
    Grid,
    GridStore,
    PushFailure,
    Ref,
    RuleSet,
)

from grid_parser import parse_grids, parse_grids_concise


# =============================================================================
# Rotation Utilities
# =============================================================================


def rotate_grid_90(grid: Grid) -> Grid:
    """
    Rotate a Grid 90° clockwise.

    In an N×M grid rotated 90° clockwise, it becomes M×N.
    Position (row, col) → (col, N - 1 - row)
    """
    original_rows = grid.rows
    original_cols = grid.cols

    # Create new cells array with swapped dimensions
    new_cells: list[list[Cell]] = [[None] * original_rows for _ in range(original_cols)]  # type: ignore

    for row in range(original_rows):
        for col in range(original_cols):
            new_row = col
            new_col = original_rows - 1 - row
            new_cells[new_row][new_col] = grid.cells[row][col]

    # Convert to tuple of tuples for frozen Grid
    return Grid(grid.id, tuple(tuple(row) for row in new_cells))


def rotate_grid_store_90(store: GridStore) -> GridStore:
    """Rotate all grids in a GridStore 90° clockwise."""
    return {grid_id: rotate_grid_90(grid) for grid_id, grid in store.items()}


def rotate_direction_90(direction: Direction) -> Direction:
    """Rotate a direction 90° clockwise."""
    rotation_map = {
        Direction.N: Direction.E,
        Direction.E: Direction.S,
        Direction.S: Direction.W,
        Direction.W: Direction.N,
    }
    return rotation_map[direction]


def get_grid_store_dimensions(store: GridStore) -> dict[str, tuple[int, int]]:
    """Get dimensions for all grids in a GridStore."""
    return {grid_id: (grid.rows, grid.cols) for grid_id, grid in store.items()}


def rotate_position_90(
    grid_id: str,
    row: int,
    col: int,
    store: GridStore
) -> tuple[int, int]:
    """
    Rotate a position 90° clockwise within its grid.

    In an N×M grid rotated 90° clockwise, it becomes M×N.
    Position (row, col) → (col, N - 1 - row)

    Args:
        grid_id: ID of the grid containing this position
        row: Original row index
        col: Original column index
        store: GridStore containing the grid (before rotation)

    Returns:
        (new_row, new_col) after rotation
    """
    grid = store[grid_id]
    original_rows = grid.rows
    new_row = col
    new_col = original_rows - 1 - row
    return new_row, new_col


# =============================================================================
# Test Case Data Structures
# =============================================================================


@dataclass
class ExpectedFailure:
    """Expected failure result with reason."""
    reason: str  # e.g., "PATH_CYCLE", "NO_STRATEGY", "STOP_TAG"

    __test__ = False


@dataclass
class TestVariation:
    """A single test variation with start position, direction, and expected results."""

    expected: list[tuple[str, int, int, str]] | ExpectedFailure  # Success: cell list, Failure: reason

    start_grid: str
    start_row: int = 0
    start_col: int = 0
    direction: Direction = Direction.E
    description: str = ""

    __test__ = False

    def rotate_90(self, store: GridStore) -> "TestVariation":
        """Create a new TestVariation rotated 90° clockwise."""
        new_row, new_col = rotate_position_90(
            self.start_grid, self.start_row, self.start_col, store
        )

        # If expecting failure, it doesn't need rotation (reason is direction-independent)
        new_expected: list[tuple[str, int, int, str]] | ExpectedFailure
        if isinstance(self.expected, ExpectedFailure):
            new_expected = self.expected
        else:
            new_expected = []
            for grid_id, row, col, content in self.expected:
                exp_row, exp_col = rotate_position_90(grid_id, row, col, store)
                new_expected.append((grid_id, exp_row, exp_col, content))

        return TestVariation(
            start_grid=self.start_grid,
            start_row=new_row,
            start_col=new_col,
            direction=rotate_direction_90(self.direction),
            expected=new_expected,
            description=f"{self.description} [rotated 90°]" if self.description else "[rotated 90°]"
        )


@dataclass
class RotationalTestCase:
    """
    A test case that will be run in all 4 rotations.

    Example usage:
        test = RotationalTestCase(
            name="push_simple",
            grids={"main": "A B _"},
            variations=[
                TestVariation(
                    start_grid="main",
                    start_row=0,
                    start_col=0,
                    direction=Direction.E,
                    expected=[
                        ("main", 0, 0, "_"),
                        ("main", 0, 1, "A"),
                        ("main", 0, 2, "B"),
                    ],
                    description="push A east into empty"
                )
            ]
        )
    """

    name: str
    grids: dict[str, str] | str
    variations: list[TestVariation]
    store: GridStore = None  # type: ignore  # Initialized in __post_init__

    def __post_init__(self) -> None:
        """Parse grids into GridStore on construction."""
        if isinstance(self.grids, dict):
            object.__setattr__(self, 'store', parse_grids(self.grids))
        else:
            object.__setattr__(self, 'store', parse_grids_concise(self.grids))

    def get_all_rotations(self) -> list[tuple[int, GridStore, TestVariation]]:
        """
        Generate all 4 rotations of this test case.

        Returns:
            List of (rotation_degrees, store, variation) tuples
        """
        results = []

        current_store = self.store
        current_variations = self.variations

        for rotation in [0, 90, 180, 270]:
            for variation in current_variations:
                results.append((rotation, current_store, variation))

            if rotation < 270:  # Don't rotate after the last iteration
                # Rotate store for next iteration (using current store BEFORE rotation)
                old_store = current_store
                current_store = rotate_grid_store_90(current_store)
                # Rotate all variations using OLD store (create new list)
                current_variations = [v.rotate_90(old_store) for v in current_variations]

        return results


# =============================================================================
# Test Runner
# =============================================================================


def run_rotational_test(
    test_case: RotationalTestCase,
    operations: list[Callable[[GridStore, CellPosition, Direction, RuleSet], GridStore | object]],
    rules: RuleSet | None = None,
    assert_fn: Callable[[GridStore, list[tuple[str, int, int, str]]], None] | None = None
) -> None:
    """
    Run a rotational test case through all 4 rotations.

    Args:
        test_case: The test case to run
        operation: The operation to test (e.g., push, pull)
        rules: Optional RuleSet to pass to the operation
        assert_fn: Optional custom assertion function. If None, uses default cell checking.
    """
    if rules is None:
        rules = RuleSet()

    if assert_fn is None:
        assert_fn = default_assert_cells

    rotations = test_case.get_all_rotations()

    for operation in operations:
        for rotation, store, variation in rotations:
            # Execute the operation on the rotated store
            start = CellPosition(variation.start_grid, variation.start_row, variation.start_col)
            result = operation(store, start, variation.direction, rules)

            # Check if expecting failure
            if isinstance(variation.expected, ExpectedFailure):
                # Expecting a failure
                assert isinstance(result, PushFailure), (
                    f"{test_case.name} at {rotation}° - {variation.description}: "
                    f"Expected failure with reason '{variation.expected.reason}', but operation succeeded"
                )
                assert result.reason == variation.expected.reason, (
                    f"{test_case.name} at {rotation}° - {variation.description}: "
                    f"Expected failure reason '{variation.expected.reason}', got '{result.reason}'"
                )
            else:
                # Expecting success - verify it's a successful result (dict)
                assert isinstance(result, dict), (
                    f"{test_case.name} at {rotation}° - {variation.description}: "
                    f"Operation failed with {result}"
                )

                # Run assertions
                try:
                    assert_fn(result, variation.expected)
                except AssertionError as e:
                    raise AssertionError(
                        f"{test_case.name} at {rotation}° - {variation.description}: {e}"
                    ) from e


def default_assert_cells(
    result: GridStore,
    expected: list[tuple[str, int, int, str]]
) -> None:
    """
    Default assertion function: check that cells match expected content.

    Args:
        result: The resulting GridStore
        expected: List of (grid_id, row, col, cell_content) tuples
            where cell_content is:
            - "_" for Empty
            - "GRID_ID" (uppercase) for Ref
            - anything else for Concrete
    """
    for grid_id, row, col, content in expected:
        cell = result[grid_id].cells[row][col]

        if content == "_":
            assert isinstance(cell, Empty), (
                f"Expected Empty at [{grid_id}]({row},{col}), got {cell}"
            )
        elif content.isupper() and len(content) > 1:
            # Assume it's a Ref (uppercase indicates ref by convention)
            assert isinstance(cell, Ref), (
                f"Expected Ref at [{grid_id}]({row},{col}), got {cell}"
            )
            assert cell.grid_id == content, (
                f"Expected Ref({content}) at [{grid_id}]({row},{col}), got Ref({cell.grid_id})"
            )
        else:
            assert isinstance(cell, Concrete), (
                f"Expected Concrete at [{grid_id}]({row},{col}), got {cell}"
            )
            assert cell.id == content, (
                f"Expected Concrete({content}) at [{grid_id}]({row},{col}), got Concrete({cell.id})"
            )


# =============================================================================
# Example Test Cases
# =============================================================================


def example_push_simple() -> RotationalTestCase:
    """Example: Simple push into empty cell."""
    return RotationalTestCase(
        name="push_simple",
        grids={"main": "1 2 _"},
        variations=[
            TestVariation(
                start_grid="main",
                start_row=0,
                start_col=0,
                direction=Direction.E,
                expected=[
                    ("main", 0, 0, "_"),
                    ("main", 0, 1, "1"),
                    ("main", 0, 2, "2"),
                ],
                description="push 1 east into empty"
            )
        ]
    )


def example_push_through_portal() -> RotationalTestCase:
    """Example: Push through a portal ref."""
    return RotationalTestCase(
        name="push_through_portal",
        grids={
            "main": "1 INNER _",
            "INNER": "x y"
        },
        variations=[
            TestVariation(
                start_grid="main",
                start_row=0,
                start_col=0,
                direction=Direction.E,
                expected=[
                    ("main", 0, 0, "_"),
                    ("main", 0, 1, "INNER"),  # Ref stays
                    ("main", 0, 2, "y"),      # y exits portal
                    ("INNER", 0, 0, "1"),     # 1 enters portal
                    ("INNER", 0, 1, "x"),     # x shifts right
                ],
                description="push 1 through portal"
            )
        ]
    )
