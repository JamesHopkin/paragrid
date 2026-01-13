"""
Grid parsing utilities for Paragrid.

Provides two parsing formats:
1. Standard format with spaces and explicit markers
2. Concise format with single-character cells
"""

from __future__ import annotations

from grid_types import Grid, GridStore, Cell, Empty, Concrete, Ref

__all__ = ["parse_grids", "parse_grids_concise"]


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


def parse_grids_concise(definition: str) -> GridStore:
    """
    Parse grid definitions from a concise multi-line format.

    Format:
    - One grid per line: "name: grid_definition"
    - Grid definition uses single characters (no spaces between cells)
    - Rows separated by |
    - Cell types:
      * Digit (0-9): Concrete cell with that digit as content
      * Underscore (_): Empty cell
      * Lowercase letter: Ref to grid whose name starts with that letter (auto-determined primary)
      * Uppercase letter: Primary ref to grid whose name starts with that letter (is_primary=True)

    Grid name matching:
    - References match grid names by first character (case-insensitive)
    - Grid names must have unique first characters (case-insensitive)
    - Example: 'a' or 'A' both reference a grid like "Apple" or "alpha"

    Example:
        \"\"\"
        main: 12_3|a__4
        Apple: 56|78
        \"\"\"

        Creates:
        - Grid "main": [[Concrete("1"), Concrete("2"), Empty(), Concrete("3")],
                        [Ref("Apple", is_primary=None), Empty(), Empty(), Concrete("4")]]
        - Grid "Apple": [[Concrete("5"), Concrete("6")],
                         [Concrete("7"), Concrete("8")]]

    Args:
        definition: Multi-line string with one grid per line

    Returns:
        GridStore with parsed grids

    Raises:
        ValueError: If grid names have duplicate first characters or invalid format
    """
    store: GridStore = {}
    lines = [line.strip() for line in definition.strip().split("\n") if line.strip()]

    # First pass: collect grid names and validate uniqueness of first characters
    grid_definitions: list[tuple[str, str]] = []
    first_chars: dict[str, str] = {}  # lowercase first char -> grid name

    for line_idx, line in enumerate(lines):
        if ":" not in line:
            raise ValueError(
                f"Invalid grid definition on line {line_idx + 1}: '{line}'\n"
                f"  Expected format: 'name: grid_definition'"
            )

        parts = line.split(":", 1)
        if len(parts) != 2:
            raise ValueError(
                f"Invalid grid definition on line {line_idx + 1}: '{line}'\n"
                f"  Expected exactly one colon separator"
            )

        grid_name = parts[0].strip()
        grid_def = parts[1].strip()

        if not grid_name:
            raise ValueError(
                f"Empty grid name on line {line_idx + 1}: '{line}'"
            )

        if not grid_def:
            raise ValueError(
                f"Empty grid definition for '{grid_name}' on line {line_idx + 1}"
            )

        # Check first character uniqueness (case-insensitive)
        first_char_lower = grid_name[0].lower()
        if first_char_lower in first_chars:
            raise ValueError(
                f"Duplicate first character in grid names:\n"
                f"  Grid '{first_chars[first_char_lower]}' and '{grid_name}' both start with '{first_char_lower}'\n"
                f"  Grid names must have unique first characters (case-insensitive)"
            )

        first_chars[first_char_lower] = grid_name
        grid_definitions.append((grid_name, grid_def))

    # Second pass: parse grid definitions
    for grid_name, grid_def in grid_definitions:
        # Split into rows
        row_strings = grid_def.split("|")
        rows: list[tuple[Cell, ...]] = []

        for row_idx, row_str in enumerate(row_strings):
            cells: list[Cell] = []

            # Each character is a cell
            for col_idx, char in enumerate(row_str):
                if char.isdigit():
                    cells.append(Concrete(char))
                elif char == "_":
                    cells.append(Empty())
                elif char.isalpha():
                    # Find grid by first character (case-insensitive)
                    target_char = char.lower()
                    if target_char not in first_chars:
                        raise ValueError(
                            f"Unknown grid reference '{char}' in grid '{grid_name}'\n"
                            f"  Row {row_idx}, column {col_idx}\n"
                            f"  No grid name starts with '{char}' (case-insensitive)\n"
                            f"  Available grids: {', '.join(sorted(first_chars.values()))}"
                        )

                    target_grid = first_chars[target_char]
                    # Uppercase = primary, lowercase = auto-determined
                    is_primary = True if char.isupper() else None
                    cells.append(Ref(target_grid, is_primary=is_primary))
                else:
                    raise ValueError(
                        f"Invalid character '{char}' in grid '{grid_name}'\n"
                        f"  Row {row_idx}, column {col_idx}\n"
                        f"  Valid characters: digits (0-9), underscore (_), letters (a-zA-Z)"
                    )

            rows.append(tuple(cells))

        # Pad rows to maximum length with Empty cells
        if rows:
            max_cols = max(len(row) for row in rows)
            padded_rows: list[tuple[Cell, ...]] = []
            for row in rows:
                if len(row) < max_cols:
                    # Pad with Empty cells
                    padded_row = list(row) + [Empty()] * (max_cols - len(row))
                    padded_rows.append(tuple(padded_row))
                else:
                    padded_rows.append(row)
            rows = padded_rows

        # Create Grid
        grid = Grid(grid_name, tuple(rows))
        store[grid_name] = grid

    return store
