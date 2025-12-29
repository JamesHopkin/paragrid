"""
ASCII rendering for Paragrid structures.

Provides two rendering approaches:
1. Recursive rendering (analyze-based) with fractional scaling - shows nested grid structure
2. Simple flow rendering - displays all grids as flat character grids in flow layout
"""

from __future__ import annotations

import logging
from fractions import Fraction
from math import lcm
from typing import Callable

import simple_chalk as chalk  # type: ignore[import-untyped]

from paragrid import (
    CellNode,
    CellPosition,
    Concrete,
    ConcreteNode,
    CutoffNode,
    Empty,
    EmptyNode,
    Grid,
    GridStore,
    NestedNode,
    Ref,
    RefNode,
)

logger = logging.getLogger(__name__)


# =============================================================================
# Recursive Rendering (Analyze-Based)
# =============================================================================


def collect_denominators(node: CellNode) -> tuple[set[int], set[int]]:
    """Collect all denominators from nested grid dimensions separately for width and height.

    Tracks visited grids to prevent infinite recursion on cyclic references.

    Returns:
        Tuple of (width_denoms, height_denoms)
    """
    width_denoms: set[int] = set()
    height_denoms: set[int] = set()
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
                width_denoms.add(cw.denominator)
                height_denoms.add(ch.denominator)
                for row in n.children:
                    for child in row:
                        walk(child, cw, ch)
        elif isinstance(n, RefNode):
            # Just walk the content - the NestedNode inside will handle cycle detection
            walk(n.content, w, h)

    walk(node, Fraction(1), Fraction(1))
    return (width_denoms, height_denoms)


def compute_scale(node: CellNode, max_scale: int = 10000) -> tuple[int, int]:
    """
    Compute character dimensions that give exact integer cell sizes.

    Uses separate LCM calculations for width and height to minimize output size.

    Args:
        node: The cell tree to compute scale for
        max_scale: Maximum scale to prevent excessive memory usage (default 10000)

    Returns:
        Tuple of (width, height) in characters
    """
    width_denoms, height_denoms = collect_denominators(node)

    # Compute width scale
    width_scale = 1
    width_capped = False
    if width_denoms:
        for d in width_denoms:
            new_scale = lcm(width_scale, d)
            if new_scale > max_scale:
                width_capped = True
                break
            width_scale = new_scale

    # Compute height scale
    height_scale = 1
    height_capped = False
    if height_denoms:
        for d in height_denoms:
            new_scale = lcm(height_scale, d)
            if new_scale > max_scale:
                height_capped = True
                break
            height_scale = new_scale

    logger.info(
        "compute_scale: width=%d (capped=%s), height=%d (capped=%s), max_scale=%d",
        width_scale,
        width_capped,
        height_scale,
        height_capped,
        max_scale,
    )
    return (width_scale, height_scale)


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


# =============================================================================
# Simple Flow Rendering (No Recursion/Scaling)
# =============================================================================


def render_grid_simple(
    grid: Grid,
    grid_id: str,
    cell_width: int = 3,
    highlight_pos: CellPosition | None = None,
    color_fn: Callable[[str], Callable[[str], str]] | None = None,
    store: GridStore | None = None,
    tag_fn: Callable[[Empty | Concrete | Ref], set[str]] | None = None,
) -> list[str]:
    """
    Render a single grid as simple character display (no recursion).

    Args:
        grid: The grid to render
        grid_id: ID of this grid
        cell_width: Characters per cell (default 3)
        highlight_pos: Optional position to highlight
        color_fn: Optional function returning colorizer for grid_id
        store: Optional grid store for determining primary refs
        tag_fn: Optional function to get tags for cells

    Returns:
        List of strings representing the rendered grid lines
    """
    # Helper to check if a Ref at a specific position is primary
    def is_ref_primary(ref_grid_id: str, row: int, col: int) -> bool:
        """Check if a Ref at this position is the primary ref to ref_grid_id."""
        if store is None:
            return False

        # Check explicit is_primary first
        cell = grid.cells[row][col]
        if isinstance(cell, Ref):
            if cell.is_primary is True:
                return True
            if cell.is_primary is False:
                return False

        # Auto-determine: check if this is the first ref to ref_grid_id in the store
        # First pass: look for explicit primary
        for g in store.values():
            for r, grid_row in enumerate(g.cells):
                for c, cell in enumerate(grid_row):
                    if isinstance(cell, Ref) and cell.grid_id == ref_grid_id and cell.is_primary is True:
                        # Found explicit primary - check if it's us
                        return g.id == grid_id and r == row and c == col

        # Second pass: first ref found is primary
        for g in store.values():
            for r, grid_row in enumerate(g.cells):
                for c, cell in enumerate(grid_row):
                    if isinstance(cell, Ref) and cell.grid_id == ref_grid_id:
                        # This is the first ref - check if it's us
                        return g.id == grid_id and r == row and c == col

        return False

    if color_fn is None:
        color_fn = lambda gid: lambda s: s

    colorize = color_fn(grid_id)
    rows, cols = len(grid.cells), len(grid.cells[0])

    # Calculate dimensions
    border_width = 2  # left and right borders
    title = f" {grid_id} "
    grid_width = cols * cell_width + border_width

    lines: list[str] = []

    # Top border with title
    title_line = "┌" + "─" * (grid_width - 2) + "┐"
    # Center title in the border
    if len(title) <= grid_width - 2:
        title_start = (grid_width - len(title)) // 2
        title_line = (
            "┌" +
            "─" * (title_start - 1) +
            title +
            "─" * (grid_width - title_start - len(title) - 1) +
            "┐"
        )
    lines.append(colorize(title_line))

    # Grid rows
    for r_idx, row in enumerate(grid.cells):
        line_parts = [colorize("│")]

        for c_idx, cell in enumerate(row):
            # Check if this cell should be highlighted
            is_highlighted = (
                highlight_pos is not None
                and highlight_pos.grid_id == grid_id
                and highlight_pos.row == r_idx
                and highlight_pos.col == c_idx
            )

            # Check if cell is tagged with "stop"
            has_stop_tag = False
            if tag_fn is not None:
                tags = tag_fn(cell)
                has_stop_tag = "stop" in tags

            # Determine cell content (always single character)
            if has_stop_tag:
                # Stop-tagged cells always show as #
                char = "#"
            else:
                match cell:
                    case Empty():
                        char = "_"
                    case Concrete(id=cell_id):
                        # Use first character of id
                        char = cell_id[0] if cell_id else "?"
                    case Ref(grid_id=ref_id):
                        # Use first letter of referenced grid (uppercase for primary, lowercase for secondary)
                        first_letter = ref_id[0] if ref_id else "?"
                        if is_ref_primary(ref_id, r_idx, c_idx):
                            char = first_letter.upper()
                        else:
                            char = first_letter.lower()

            # Apply padding based on cell_width
            if cell_width == 1:
                content = char
            else:
                # Center character with padding
                content = char.center(cell_width)

            # Apply highlighting (white background)
            if is_highlighted:
                content = chalk.bgWhite.black(content)
            else:
                content = colorize(content)

            line_parts.append(content)

        line_parts.append(colorize("│"))
        lines.append("".join(line_parts))

    # Bottom border
    lines.append(colorize("└" + "─" * (grid_width - 2) + "┘"))

    return lines


def render_store_flow(
    store: GridStore,
    terminal_width: int = 120,
    cell_width: int = 3,
    highlight_pos: CellPosition | None = None,
    tag_fn: Callable[[Empty | Concrete | Ref], set[str]] | None = None,
) -> str:
    """
    Render all grids in flow layout (multiple grids per row).

    Args:
        store: The grid store containing all grids
        terminal_width: Maximum width for layout (default 120)
        cell_width: Characters per cell (default 3)
        highlight_pos: Optional position to highlight
        tag_fn: Optional function to get tags for cells

    Returns:
        Rendered ASCII string with all grids in flow layout
    """
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

    grid_ids = sorted(store.keys())
    grid_colors: dict[str, Callable[[str], str]] = {
        gid: colors[i % len(colors)] for i, gid in enumerate(grid_ids)
    }

    def color_fn(grid_id: str) -> Callable[[str], str]:
        return grid_colors.get(grid_id, lambda s: s)

    # Render all grids
    rendered_grids: dict[str, list[str]] = {}
    grid_widths: dict[str, int] = {}

    for grid_id in grid_ids:
        grid = store[grid_id]
        rendered_grids[grid_id] = render_grid_simple(
            grid, grid_id, cell_width, highlight_pos, color_fn, store, tag_fn
        )
        # Calculate width from first line (all lines should be same width)
        if rendered_grids[grid_id]:
            # Need to strip ANSI codes to get actual width
            # Simple approach: count visible characters
            first_line = rendered_grids[grid_id][0]
            # Approximate: actual line length, accounting for ANSI codes
            # For simplicity, just use the grid's column count
            cols = len(grid.cells[0])
            grid_widths[grid_id] = cols * cell_width + 2  # +2 for borders

    # Layout grids in rows - fit as many as possible per row
    output_lines: list[str] = []
    grid_spacing = 2  # spaces between grids

    current_row_grids: list[str] = []
    current_row_width = 0

    for grid_id in grid_ids:
        grid_width = grid_widths[grid_id]

        # Check if this grid fits in current row
        needed_width = grid_width
        if current_row_grids:
            needed_width += grid_spacing  # Add spacing if not first in row

        if current_row_grids and current_row_width + needed_width > terminal_width:
            # Start new row - flush current row
            _flush_grid_row(current_row_grids, rendered_grids, grid_widths, output_lines, grid_spacing)
            current_row_grids = []
            current_row_width = 0

        # Add grid to current row
        current_row_grids.append(grid_id)
        current_row_width += needed_width

    # Flush remaining grids
    if current_row_grids:
        _flush_grid_row(current_row_grids, rendered_grids, grid_widths, output_lines, grid_spacing)

    return "\n".join(output_lines)


def _flush_grid_row(
    row_grid_ids: list[str],
    rendered_grids: dict[str, list[str]],
    grid_widths: dict[str, int],
    output_lines: list[str],
    grid_spacing: int,
) -> None:
    """Helper to flush a row of grids to output_lines."""
    row_grids = [rendered_grids[gid] for gid in row_grid_ids]

    # Find max height in this row
    max_height = max(len(g) for g in row_grids)

    # Pad all grids to same height using actual grid widths (not string length)
    for grid_id, grid_lines in zip(row_grid_ids, row_grids):
        visible_width = grid_widths[grid_id]
        while len(grid_lines) < max_height:
            grid_lines.append(" " * visible_width)

    # Combine grids horizontally
    for line_idx in range(max_height):
        line_parts = []
        for grid_id, grid_lines in zip(row_grid_ids, row_grids):
            if line_idx < len(grid_lines):
                line_parts.append(grid_lines[line_idx])
            else:
                line_parts.append(" " * grid_widths[grid_id])

        # Join with spacing between grids
        output_lines.append((" " * grid_spacing).join(line_parts))

    # Add spacing between rows
    output_lines.append("")
