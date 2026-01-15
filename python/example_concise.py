"""Example demonstrating the concise grid parser."""

from paragrid import parse_grids_concise

# Define grids using the concise format
definition = """
Main: 123|4s6|789
sub: 56|78
"""

store = parse_grids_concise(definition)

# Print the parsed grids
for grid_id, grid in store.items():
    print(f"\nGrid: {grid_id}")
    print(f"Size: {grid.rows}x{grid.cols}")
    for r, row in enumerate(grid.cells):
        print(f"  Row {r}: {row}")

# Example with primary refs and padding
definition2 = """
main: 1S|3
Sub: 56|78
"""

store2 = parse_grids_concise(definition2)

print("\n\n=== Example with primary ref and row padding ===")
for grid_id, grid in store2.items():
    print(f"\nGrid: {grid_id}")
    print(f"Size: {grid.rows}x{grid.cols}")
    for r, row in enumerate(grid.cells):
        print(f"  Row {r}: {row}")
