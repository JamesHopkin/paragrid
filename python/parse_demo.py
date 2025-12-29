#!/usr/bin/env python3
"""
Demo of the string-based grid definition format.
"""

from fractions import Fraction

from paragrid import analyze, parse_grids
from ascii_render import render


def main() -> None:
    """Demonstrate parsing grids from strings."""

    # Example 1: Simple concrete grid
    print("Example 1: Simple 2x2 grid")
    print("-" * 40)
    store1 = parse_grids({
        "main": "1 2|3 4"
    })
    tree1 = analyze(store1, "main", Fraction(20), Fraction(10))
    print(render(tree1))
    print()

    # Example 2: Grid with a reference
    print("Example 2: Grid with reference")
    print("-" * 40)
    store2 = parse_grids({
        "main": "1 A|2 3",
        "A": "4 5|6 7"
    })
    tree2 = analyze(store2, "main", Fraction(20), Fraction(10))
    print(render(tree2))
    print()

    # Example 3: Nested references
    print("Example 3: Nested references (A contains B)")
    print("-" * 40)
    store3 = parse_grids({
        "main": "1 A|2 3",
        "A": "4 B",
        "B": "5|6"
    })
    tree3 = analyze(store3, "main", Fraction(30), Fraction(15))
    print(render(tree3))
    print()

    # Example 4: Grid with empty cells
    print("Example 4: Grid with empty cells")
    print("-" * 40)
    store4 = parse_grids({
        "main": "1 _ 3|_ A _",
        "A": "2"
    })
    tree4 = analyze(store4, "main", Fraction(30), Fraction(10))
    print(render(tree4))
    print()

    # Example 5: Recursive reference
    print("Example 5: Self-referential grid")
    print("-" * 40)
    store5 = parse_grids({
        "main": "1 main|2 3"
    })
    tree5 = analyze(store5, "main", Fraction(20), Fraction(10))
    print(render(tree5))
    print()

    # Example 6: Complex structure
    print("Example 6: Complex multi-grid structure")
    print("-" * 40)
    store6 = parse_grids({
        "root": "A B|C D",
        "A": "1 2",
        "B": "3|4",
        "C": "5 6|7 8",
        "D": "9"
    })
    tree6 = analyze(store6, "root", Fraction(40), Fraction(20))
    print(render(tree6))


if __name__ == "__main__":
    main()
