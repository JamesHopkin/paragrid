"""
Ancestor-based entry position calculation.

Uses rational arithmetic to map exit positions through common ancestors,
enabling consistent cross-depth entry without tracking depth state.

IMPORTANT: This module is intentionally brittle and relies on strong guarantees
provided by the push algorithm:

1. Both functions are always called with ancestor parameters specified
   (stop_at_ancestor/ancestor_grid_id are never None in practice)
2. The specified ancestor is guaranteed to exist in the ancestry chain
3. The push algorithm ensures these invariants before calling these functions

The "reached root" cases are defensive checks that should never execute in correct
usage. They include assertions to catch API misuse during development.
"""

from __future__ import annotations
from fractions import Fraction
from typing import TYPE_CHECKING, Callable

if TYPE_CHECKING:
    from grid_types import GridStore

# Type alias for find_primary_ref function
FindPrimaryRefFn = Callable[["GridStore", str], tuple[str, int, int] | None]


def compute_cell_center_fraction(cell_index: int, dimension: int) -> Fraction:
    """
    Compute the fractional position of a cell's center along a dimension.

    Cell centers are evenly spaced within [0, 1], positioned at (i+1)/(N+1) for i=0..N-1.

    Args:
        cell_index: 0-based index of the cell
        dimension: Total number of cells in this dimension

    Returns:
        Fraction in [0, 1] representing center position

    Examples:
        - dimension=1, cell_index=0 → 1/2 = 0.5 (center of only cell)
        - dimension=3, cell_index=0 → 1/4 = 0.25 (first third)
        - dimension=3, cell_index=1 → 2/4 = 0.5 (middle)
        - dimension=3, cell_index=2 → 3/4 = 0.75 (last third)
    """
    return Fraction(cell_index + 1, dimension + 1)


def map_fraction_through_parent(
    local_fraction: Fraction,
    parent_cell_index: int,
    parent_dimension: int,
) -> Fraction:
    """
    Map a fractional position within a child grid through its parent cell.

    The child grid occupies a single cell in the parent, uniformly spanning [i/n, (i+1)/n].
    Maps child's [0, 1] space to this parent cell interval.

    Args:
        local_fraction: Position within child (0.0 to 1.0)
        parent_cell_index: Which parent cell contains this child
        parent_dimension: Number of cells in parent along this axis

    Returns:
        Fraction in parent's coordinate system
    """
    return (local_fraction + parent_cell_index) / parent_dimension


def map_fraction_to_child(
    parent_fraction: Fraction,
    parent_cell_index: int,
    parent_dimension: int,
) -> Fraction:
    """
    Map a position in parent coordinate space to child coordinate space.

    Inverse of map_fraction_through_parent.

    Args:
        parent_fraction: Position in parent's coordinate system
        parent_cell_index: Which parent cell contains the child
        parent_dimension: Number of cells in parent along this axis

    Returns:
        Fraction in child's [0, 1] coordinate system
    """
    local = parent_fraction * parent_dimension - parent_cell_index

    # Assert result is in valid range [0, 1]
    assert 0 <= local <= 1, (
        f"Mapped fraction {local} out of range [0, 1]. "
        f"parent_fraction={parent_fraction}, parent_cell_index={parent_cell_index}, "
        f"parent_dimension={parent_dimension}"
    )

    return local


def fraction_to_cell_index(fraction: Fraction, dimension: int) -> int:
    """
    Convert a fractional position to a cell index using floor.

    Args:
        fraction: Position in [0, 1]
        dimension: Number of cells

    Returns:
        Cell index (0-based), clamped to [0, dimension-1]
    """
    # Convert fraction to cell index: floor(f * n)
    # Clamp to valid range to handle f = 1.0 edge case
    index = int(fraction * dimension)
    return min(index, dimension - 1)


def compute_exit_ancestor_fraction(
    store: GridStore,
    find_primary_ref_fn: FindPrimaryRefFn,
    grid_id: str,
    cell_index: int,
    dimension_attr: str,  # 'rows' or 'cols'
    stop_at_ancestor: str,
) -> tuple[Fraction, str]:
    """
    Compute the fractional position of a cell along an edge, in ancestor coordinates.

    Cascades up through parent grids, transforming the position at each level.

    Args:
        store: Grid store
        find_primary_ref_fn: Function to find primary ref (returns (parent_id, row, col) | None)
        grid_id: ID of the grid we're exiting from
        cell_index: Cell index (row or col) we're exiting from
        dimension_attr: 'rows' or 'cols'
        stop_at_ancestor: Ancestor ID to stop at (must be in ancestry chain)

    Returns:
        (fraction in ancestor coordinates, ancestor_grid_id)
    """
    current_grid = store[grid_id]
    dimension = getattr(current_grid, dimension_attr)
    fraction = compute_cell_center_fraction(cell_index, dimension)
    current_grid_id = grid_id

    # Cascade up through parents, transforming fraction
    while True:
        # Stop if we reached the target ancestor
        if current_grid_id == stop_at_ancestor:
            return fraction, current_grid_id

        ref = find_primary_ref_fn(store, current_grid_id)
        if ref is None:  # pragma: no cover
            # Should be unreachable - caller must ensure stop_at_ancestor is in ancestry chain
            raise AssertionError(
                f"stop_at_ancestor '{stop_at_ancestor}' not found in ancestry of '{grid_id}'"
            )

        parent_grid_id, ref_row, ref_col = ref
        parent_grid = store[parent_grid_id]
        parent_dimension = getattr(parent_grid, dimension_attr)

        # Transform fraction through parent
        parent_cell_index = ref_row if dimension_attr == 'rows' else ref_col
        fraction = map_fraction_through_parent(
            fraction,
            parent_cell_index,
            parent_dimension,
        )

        current_grid_id = parent_grid_id


def compute_entry_from_ancestor_fraction(
    store: GridStore,
    find_primary_ref_fn: FindPrimaryRefFn,
    target_grid_id: str,
    ancestor_fraction: Fraction,
    dimension_attr: str,  # 'rows' or 'cols'
    ancestor_grid_id: str,
) -> int:
    """
    Compute entry cell index by mapping from ancestor fraction down to target grid.

    Args:
        store: Grid store
        find_primary_ref_fn: Function to find primary ref (returns (parent_id, row, col) | None)
        target_grid_id: Grid to enter
        ancestor_fraction: Position in ancestor's coordinate system
        dimension_attr: 'rows' or 'cols'
        ancestor_grid_id: Ancestor grid ID to start from (must be in ancestry chain)

    Returns:
        Cell index to enter
    """
    # Build path from target to specified ancestor
    path: list[tuple[str, tuple[str, int, int]]] = []
    current = target_grid_id

    while True:
        # Stop if we reached the specified ancestor
        if current == ancestor_grid_id:
            break

        ref = find_primary_ref_fn(store, current)
        if ref is None:  # pragma: no cover
            # Should be unreachable - caller must ensure ancestor_grid_id is in ancestry chain
            raise AssertionError(
                f"ancestor_grid_id '{ancestor_grid_id}' is not an ancestor of '{target_grid_id}'"
            )

        parent_grid_id, ref_row, ref_col = ref
        path.append((current, ref))
        current = parent_grid_id

    # Reverse to go from ancestor down to target
    path.reverse()

    # Transform fraction down through hierarchy
    fraction = ancestor_fraction
    for grid_id, (parent_grid_id, ref_row, ref_col) in path:
        parent_grid = store[parent_grid_id]
        parent_dimension = getattr(parent_grid, dimension_attr)

        # Map from parent space to child space
        parent_cell_index = ref_row if dimension_attr == 'rows' else ref_col
        fraction = map_fraction_to_child(fraction, parent_cell_index, parent_dimension)

    # Convert fraction to cell index in target grid
    target_grid = store[target_grid_id]
    dimension = getattr(target_grid, dimension_attr)
    return fraction_to_cell_index(fraction, dimension)
