# String-based Grid Definition Format

The `parse_grids()` function provides a compact string format for defining grids, making it easier to write tests and demos.

## Format Specification

```python
definitions = {
    "grid_id": "row1|row2|row3"
}
```

### Cell Types

Within each row, cells are separated by spaces:

- **Numbers (0-9)**: Create `Concrete` cells
  - `"1"` → `Concrete("1")`
  - `"5"` → `Concrete("5")`

- **Letters (a-zA-Z)**: Create `Ref` cells pointing to other grids
  - `"A"` → `Ref("A")`
  - `"main"` would be parsed as 4 separate refs: `Ref("m")`, `Ref("a")`, `Ref("i")`, `Ref("n")`
  - Use single letters for grid IDs in this format

- **Spaces**: Create `Empty` cells
  - `"1  3"` → `[Concrete("1"), Empty(), Concrete("3")]`

- **Underscore (_)**: Explicit empty cell marker
  - `"1 _ 3"` → `[Concrete("1"), Empty(), Concrete("3")]`

## Examples

### Simple 2×2 Grid

```python
from paragrid import parse_grids, analyze, render
from fractions import Fraction

store = parse_grids({
    "main": "1 2|3 4"
})
tree = analyze(store, "main", Fraction(20), Fraction(10))
print(render(tree))
```

### Grid with References

```python
store = parse_grids({
    "main": "1 A|2 3",
    "A": "4 5|6 7"
})
```

This creates:
- Grid "main": 2×2 with cells `[1, Ref(A)], [2, 3]`
- Grid "A": 2×2 with cells `[4, 5], [6, 7]`

### Grid with Empty Cells

```python
store = parse_grids({
    "main": "1 _ 3|_ 2 _"
})
```

This creates a 2×3 grid with empty cells at specific positions.

### Nested References

```python
store = parse_grids({
    "root": "A B",
    "A": "1 2|3 C",
    "B": "4|5",
    "C": "6"
})
```

Grid "A" contains a reference to grid "C", creating nested structure.

### Self-Reference (Recursion)

```python
store = parse_grids({
    "main": "1 main|2 3"
})
```

Grid "main" references itself, creating a recursive structure that will be handled by the threshold termination during analysis.

## Primary vs Secondary References

The first reference to any grid becomes the **primary reference**. All subsequent references to the same grid are **secondary**. This is determined automatically during the `analyze()` phase, not in the string definition.

When exiting a grid via a secondary reference, traversal teleports to the primary reference location before continuing.

## Validation

The parser validates:
- All rows have the same number of cells
- Cell strings contain only valid characters (digits, letters, underscore, or empty)

Invalid input raises a `ValueError` with a descriptive message.

## Complete Example

```python
#!/usr/bin/env python3
from fractions import Fraction
from paragrid import parse_grids, analyze, render

# Define grids using string format
store = parse_grids({
    "main": "1 A|B 2",
    "A": "3|4",
    "B": "5 6"
})

# Analyze and render
tree = analyze(store, "main", Fraction(40), Fraction(20))
print(render(tree))
```

See `parse_demo.py` for more examples.
