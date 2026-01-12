"""
Depth-aware entry helpers for equivalent point transfer.

Provides functions to calculate exit fractions and entry positions when
traversing between grids at the same depth level, preserving positional
alignment across grid boundaries.
"""

from __future__ import annotations
from dataclasses import dataclass

from grid_types import Direction


@dataclass(frozen=True)
class DepthState:
    """Tracks depth and exit information for equivalent point transfer."""
    depth: int  # Current depth (enters - exits)
    exit_position: tuple[int, int] | None  # (row, col) when last exit occurred
    exit_depth: int | None  # Depth at which last exit occurred
    exit_fraction: float | None  # Fractional position (0.0-1.0) along edge


def calculate_exit_fraction(
    direction: Direction,
    current_row: int,
    current_col: int,
    grid_rows: int,
    grid_cols: int,
) -> float:
    """
    Calculate fractional position (0.0 to 1.0) along the edge when exiting a grid.

    Args:
        direction: Direction of movement (determines which edge)
        current_row: Row position at exit
        current_col: Column position at exit
        grid_rows: Number of rows in the grid
        grid_cols: Number of columns in the grid

    Returns:
        Fraction between 0.0 and 1.0 representing position along the exit edge
    """
    # Determine edge dimension and offset based on direction
    if direction in (Direction.E, Direction.W):
        # Exiting east or west: position is along north-south axis (row)
        edge_dimension = grid_rows
        exit_offset = current_row
    else:  # Direction.N or Direction.S
        # Exiting north or south: position is along east-west axis (col)
        edge_dimension = grid_cols
        exit_offset = current_col

    # Calculate fraction (handle single-cell dimension)
    if edge_dimension > 1:
        return exit_offset / (edge_dimension - 1)
    else:
        return 0.5  # Default to middle for single-cell dimension


def should_use_equivalent_point(
    current_depth: int | None,
    exit_depth: int | None,
    exit_fraction: float | None,
) -> bool:
    """
    Determine if equivalent point transfer should be used.

    Returns True if all depth information is available and current depth
    matches exit depth (indicating same-level transfer).

    Args:
        current_depth: Current depth after entering
        exit_depth: Depth at which last exit occurred
        exit_fraction: Fractional position at exit

    Returns:
        True if equivalent point transfer should be used
    """
    return (
        current_depth is not None
        and exit_depth is not None
        and exit_fraction is not None
        and current_depth == exit_depth
    )


def calculate_entry_index(
    exit_fraction: float,
    entry_dimension: int,
) -> int:
    """
    Calculate entry cell index from exit fraction for equivalent point transfer.

    Maps the fractional position (0.0-1.0) from the exit edge to the nearest
    cell index on the entry edge of the target grid.

    Args:
        exit_fraction: Fractional position (0.0-1.0) along exit edge
        entry_dimension: Number of cells along entry edge

    Returns:
        Cell index (0-based) to enter at
    """
    if entry_dimension > 1:
        return round(exit_fraction * (entry_dimension - 1))
    else:
        return 0


def calculate_entry_position_equivalent_point(
    direction: Direction,
    exit_fraction: float,
    grid_rows: int,
    grid_cols: int,
) -> tuple[int, int]:
    """
    Calculate entry position using equivalent point transfer.

    Preserves fractional position from exit edge to entry edge when
    entering a grid at the same depth as the last exit.

    Args:
        direction: Direction of entry
        exit_fraction: Fractional position (0.0-1.0) at exit
        grid_rows: Number of rows in target grid
        grid_cols: Number of columns in target grid

    Returns:
        (row, col) tuple for entry position
    """
    if direction == Direction.E:
        # Entering from left edge (col=0)
        # Position varies along north-south axis (row)
        entry_row = calculate_entry_index(exit_fraction, grid_rows)
        return (entry_row, 0)

    elif direction == Direction.W:
        # Entering from right edge (col=cols-1)
        # Position varies along north-south axis (row)
        entry_row = calculate_entry_index(exit_fraction, grid_rows)
        return (entry_row, grid_cols - 1)

    elif direction == Direction.S:
        # Entering from top edge (row=0)
        # Position varies along east-west axis (col)
        entry_col = calculate_entry_index(exit_fraction, grid_cols)
        return (0, entry_col)

    elif direction == Direction.N:
        # Entering from bottom edge (row=rows-1)
        # Position varies along east-west axis (col)
        entry_col = calculate_entry_index(exit_fraction, grid_cols)
        return (grid_rows - 1, entry_col)

    else:
        # Unreachable: Direction enum only has N/S/E/W
        assert False, f"unreachable: unknown direction {direction}"


def calculate_standard_entry_position(
    direction: Direction,
    grid_rows: int,
    grid_cols: int,
) -> tuple[int, int]:
    """
    Calculate standard middle-of-edge entry position.

    Used when equivalent point transfer is not applicable (e.g., entering
    at a different depth than exit, or first entry).

    Args:
        direction: Direction of entry
        grid_rows: Number of rows in target grid
        grid_cols: Number of columns in target grid

    Returns:
        (row, col) tuple for middle-of-edge entry position
    """
    if direction == Direction.E:
        # Entering from left edge
        return (grid_rows // 2, 0)
    elif direction == Direction.W:
        # Entering from right edge
        return (grid_rows // 2, grid_cols - 1)
    elif direction == Direction.S:
        # Entering from top edge
        return (0, grid_cols // 2)
    elif direction == Direction.N:
        # Entering from bottom edge
        return (grid_rows - 1, grid_cols // 2)
    else:
        # Unreachable: Direction enum only has N/S/E/W
        assert False, f"unreachable: unknown direction {direction}"
