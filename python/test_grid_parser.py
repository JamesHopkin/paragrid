"""Tests for grid_parser module."""

import pytest

from grid_parser import parse_grids, parse_grids_concise
from grid_types import Concrete, Empty, Grid, Ref


class TestParseGridsConcise:
    """Tests for the concise grid parser."""

    def test_simple_concrete_grid(self) -> None:
        """Parse a simple grid with only concrete cells."""
        definition = """
        main: 12|34
        """
        store = parse_grids_concise(definition)

        assert "main" in store
        grid = store["main"]
        assert grid.rows == 2
        assert grid.cols == 2
        assert isinstance(grid.cells[0][0], Concrete)
        assert grid.cells[0][0].id == "1"
        assert isinstance(grid.cells[0][1], Concrete)
        assert grid.cells[0][1].id == "2"
        assert isinstance(grid.cells[1][0], Concrete)
        assert grid.cells[1][0].id == "3"
        assert isinstance(grid.cells[1][1], Concrete)
        assert grid.cells[1][1].id == "4"

    def test_with_empty_cells(self) -> None:
        """Parse grid with empty cells using underscores."""
        definition = """
        main: 1_|_4
        """
        store = parse_grids_concise(definition)

        grid = store["main"]
        assert isinstance(grid.cells[0][0], Concrete)
        assert grid.cells[0][0].id == "1"
        assert isinstance(grid.cells[0][1], Empty)
        assert isinstance(grid.cells[1][0], Empty)
        assert isinstance(grid.cells[1][1], Concrete)
        assert grid.cells[1][1].id == "4"

    def test_with_refs_lowercase(self) -> None:
        """Parse grid with lowercase ref (auto-determined)."""
        definition = """
        main: 1s|34
        sub: 56|78
        """
        store = parse_grids_concise(definition)

        main = store["main"]
        sub = store["sub"]

        # Check that 's' references 'sub' (first char matches)
        assert isinstance(main.cells[0][1], Ref)
        assert main.cells[0][1].grid_id == "sub"
        assert main.cells[0][1].is_primary is None  # Auto-determined

    def test_with_refs_uppercase(self) -> None:
        """Parse grid with uppercase ref (primary)."""
        definition = """
        main: 1A|34
        Apple: 56|78
        """
        store = parse_grids_concise(definition)

        main = store["main"]
        apple = store["Apple"]

        # Check that 'A' references 'Apple' as primary
        assert isinstance(main.cells[0][1], Ref)
        assert main.cells[0][1].grid_id == "Apple"
        assert main.cells[0][1].is_primary is True  # Primary

    def test_multiple_grids(self) -> None:
        """Parse multiple grids in one definition."""
        definition = """
        main: 1a|3_
        alpha: 56|78
        """
        store = parse_grids_concise(definition)

        assert len(store) == 2
        assert "main" in store
        assert "alpha" in store

    def test_single_character_grid_names(self) -> None:
        """Parse grids with single-character names."""
        definition = """
        M: 1a|3_
        A: 56|78
        """
        store = parse_grids_concise(definition)

        main = store["M"]
        alpha = store["A"]

        # 'a' should reference 'A' (case-insensitive match)
        assert isinstance(main.cells[0][1], Ref)
        assert main.cells[0][1].grid_id == "A"

    def test_mixed_case_refs(self) -> None:
        """Test that uppercase and lowercase letters reference the same grid."""
        definition = """
        main: aA|__
        alpha: 12|34
        """
        store = parse_grids_concise(definition)

        main = store["main"]

        # Both 'a' and 'A' should reference 'alpha'
        assert isinstance(main.cells[0][0], Ref)
        assert main.cells[0][0].grid_id == "alpha"
        assert main.cells[0][0].is_primary is None  # Lowercase = auto

        assert isinstance(main.cells[0][1], Ref)
        assert main.cells[0][1].grid_id == "alpha"
        assert main.cells[0][1].is_primary is True  # Uppercase = primary

    def test_error_duplicate_first_char(self) -> None:
        """Error when grid names have duplicate first characters."""
        definition = """
        Alpha: 12|34
        Apple: 56|78
        """

        with pytest.raises(ValueError, match="Duplicate first character"):
            parse_grids_concise(definition)

    def test_error_unknown_ref(self) -> None:
        """Error when referencing unknown grid."""
        definition = """
        main: 1z|34
        """

        with pytest.raises(ValueError, match="Unknown grid reference"):
            parse_grids_concise(definition)

    def test_error_invalid_character(self) -> None:
        """Error on invalid character."""
        definition = """
        main: 1@|34
        """

        with pytest.raises(ValueError, match="Invalid character"):
            parse_grids_concise(definition)

    def test_error_missing_colon(self) -> None:
        """Error when line is missing colon."""
        definition = """
        main 12|34
        """

        with pytest.raises(ValueError, match="Expected format"):
            parse_grids_concise(definition)

    def test_error_empty_grid_name(self) -> None:
        """Error when grid name is empty."""
        definition = """
        : 12|34
        """

        with pytest.raises(ValueError, match="Empty grid name"):
            parse_grids_concise(definition)

    def test_inconsistent_row_length_pads_with_empty(self) -> None:
        """Rows with different lengths are padded with Empty cells."""
        definition = """
        main: 12|345
        """

        store = parse_grids_concise(definition)
        main = store["main"]

        # First row should be padded to 3 columns
        assert main.rows == 2
        assert main.cols == 3

        # First row: "12" -> [Concrete("1"), Concrete("2"), Empty()]
        assert isinstance(main.cells[0][0], Concrete)
        assert main.cells[0][0].id == "1"
        assert isinstance(main.cells[0][1], Concrete)
        assert main.cells[0][1].id == "2"
        assert isinstance(main.cells[0][2], Empty)

        # Second row: "345" -> [Concrete("3"), Concrete("4"), Concrete("5")]
        assert isinstance(main.cells[1][0], Concrete)
        assert main.cells[1][0].id == "3"
        assert isinstance(main.cells[1][1], Concrete)
        assert main.cells[1][1].id == "4"
        assert isinstance(main.cells[1][2], Concrete)
        assert main.cells[1][2].id == "5"

    def test_whitespace_handling(self) -> None:
        """Test that leading/trailing whitespace is handled correctly."""
        definition = """
          main:  12|34
          alpha:  56|78
        """
        store = parse_grids_concise(definition)

        assert len(store) == 2
        assert "main" in store
        assert "alpha" in store

    def test_blank_lines_ignored(self) -> None:
        """Test that blank lines are ignored."""
        definition = """
        main: 12|34

        alpha: 56|78

        """
        store = parse_grids_concise(definition)

        assert len(store) == 2
        assert "main" in store
        assert "alpha" in store

    def test_complex_example(self) -> None:
        """Test a complex example with refs, empty cells, and multiple grids."""
        definition = """
        main: 1aB|c_5
        alpha: __A|99_
        Beta: 77|88
        charlie: 66
        """
        store = parse_grids_concise(definition)

        main = store["main"]
        alpha = store["alpha"]
        beta = store["Beta"]
        charlie = store["charlie"]

        # main grid checks
        assert isinstance(main.cells[0][0], Concrete)
        assert main.cells[0][0].id == "1"

        assert isinstance(main.cells[0][1], Ref)
        assert main.cells[0][1].grid_id == "alpha"
        assert main.cells[0][1].is_primary is None

        assert isinstance(main.cells[0][2], Ref)
        assert main.cells[0][2].grid_id == "Beta"
        assert main.cells[0][2].is_primary is True

        assert isinstance(main.cells[1][0], Ref)
        assert main.cells[1][0].grid_id == "charlie"
        assert main.cells[1][0].is_primary is None

        assert isinstance(main.cells[1][1], Empty)

        assert isinstance(main.cells[1][2], Concrete)
        assert main.cells[1][2].id == "5"

        # alpha grid checks
        assert isinstance(alpha.cells[0][0], Empty)
        assert isinstance(alpha.cells[0][1], Empty)
        assert isinstance(alpha.cells[0][2], Ref)
        assert alpha.cells[0][2].grid_id == "alpha"  # Self-reference!
        assert alpha.cells[0][2].is_primary is True


class TestParseGridsStandard:
    """Test that the standard parser still works after refactoring."""

    def test_standard_parser_still_works(self) -> None:
        """Verify standard parser with spaces still works."""
        definitions = {
            "main": "123 456|789 *Main",
            "Main": "5|6",
        }
        store = parse_grids(definitions)

        assert len(store) == 2
        assert "main" in store
        assert "Main" in store

        main = store["main"]
        assert isinstance(main.cells[0][0], Concrete)
        assert main.cells[0][0].id == "123"

        assert isinstance(main.cells[0][1], Concrete)
        assert main.cells[0][1].id == "456"

        assert isinstance(main.cells[1][1], Ref)
        assert main.cells[1][1].grid_id == "Main"
        assert main.cells[1][1].is_primary is True
