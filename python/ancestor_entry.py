"""
Ancestor-based entry position calculation.

Uses rational arithmetic to map exit positions through common ancestors,
enabling consistent cross-depth entry without tracking depth state.
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


def compute_cell_extent(cell_index: int, dimension: int) -> tuple[Fraction, Fraction]:
    """
    Compute the extent (start, end) of a cell in continuous [0, 1] coordinate space.

    Cell boundaries are midpoints between adjacent centers, with edges at 0 and 1.

    Args:
        cell_index: 0-based cell index
        dimension: Total number of cells

    Returns:
        (start, end) fractions in [0, 1]
    """
    if dimension == 1:
        return (Fraction(0), Fraction(1))

    # Cell centers are at (i+1)/(N+1)
    if cell_index == 0:
        start = Fraction(0)
    else:
        # Midpoint between centers at i/(N+1) and (i+1)/(N+1)
        center_prev = Fraction(cell_index, dimension + 1)
        center_curr = Fraction(cell_index + 1, dimension + 1)
        start = (center_prev + center_curr) / 2

    if cell_index == dimension - 1:
        end = Fraction(1)
    else:
        # Midpoint between centers at (i+1)/(N+1) and (i+2)/(N+1)
        center_curr = Fraction(cell_index + 1, dimension + 1)
        center_next = Fraction(cell_index + 2, dimension + 1)
        end = (center_curr + center_next) / 2

    return (start, end)


def map_fraction_through_parent(
    local_fraction: Fraction,
    parent_cell_index: int,
    parent_dimension: int,
) -> Fraction:
    """
    Map a fractional position within a child grid through its parent cell.

    The child grid occupies a single cell in the parent. Maps child's [0, 1]
    space linearly to parent cell's extent.

    Args:
        local_fraction: Position within child (0.0 to 1.0)
        parent_cell_index: Which parent cell contains this child
        parent_dimension: Number of cells in parent along this axis

    Returns:
        Fraction in parent's coordinate system
    """
    cell_start, cell_end = compute_cell_extent(parent_cell_index, parent_dimension)
    return cell_start + local_fraction * (cell_end - cell_start)


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
    cell_start, cell_end = compute_cell_extent(parent_cell_index, parent_dimension)
    extent = cell_end - cell_start

    if extent == 0:
        return Fraction(1, 2)  # Single point, map to center

    local = (parent_fraction - cell_start) / extent

    # Clamp to [0, 1]
    if local < 0:
        return Fraction(0)
    if local > 1:
        return Fraction(1)
    return local


def find_nearest_cell(fraction: Fraction, dimension: int) -> int:
    """
    Find the cell index whose center is nearest to the given fraction.

    Args:
        fraction: Position in [0, 1]
        dimension: Number of cells

    Returns:
        Cell index (0-based)
    """
    if dimension == 1:
        return 0

    # Find cell with nearest center
    best_index = 0
    best_distance = abs(fraction - compute_cell_center_fraction(0, dimension))

    for i in range(dimension):
        center = compute_cell_center_fraction(i, dimension)
        distance = abs(fraction - center)
        if distance < best_distance:
            best_distance = distance
            best_index = i

    return best_index


def compute_exit_ancestor_fraction(
    store: GridStore,
    find_primary_ref_fn: FindPrimaryRefFn,
    grid_id: str,
    cell_index: int,
    dimension_attr: str,  # 'rows' or 'cols'
    stop_at_ancestor: str | None = None,
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
        stop_at_ancestor: Optional ancestor ID to stop at (if None, goes to root)

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
        if stop_at_ancestor is not None and current_grid_id == stop_at_ancestor:
            return fraction, current_grid_id

        ref = find_primary_ref_fn(store, current_grid_id)
        if ref is None:
            # Reached root
            return fraction, current_grid_id

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
    ancestor_grid_id: str | None = None,
) -> int:
    """
    Compute entry cell index by mapping from ancestor fraction down to target grid.

    Args:
        store: Grid store
        find_primary_ref_fn: Function to find primary ref (returns (parent_id, row, col) | None)
        target_grid_id: Grid to enter
        ancestor_fraction: Position in ancestor's coordinate system
        dimension_attr: 'rows' or 'cols'
        ancestor_grid_id: Optional ancestor grid ID to start from (if None, starts from root)

    Returns:
        Cell index to enter
    """
    # Build path from target to root (or specified ancestor)
    path: list[tuple[str, tuple[str, int, int]]] = []
    current = target_grid_id

    while True:
        # Stop if we reached the specified ancestor
        if ancestor_grid_id is not None and current == ancestor_grid_id:
            break

        ref = find_primary_ref_fn(store, current)
        if ref is None:
            break

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

    # Find nearest cell in target grid
    target_grid = store[target_grid_id]
    dimension = getattr(target_grid, dimension_attr)
    return find_nearest_cell(fraction, dimension)
