# String-based Grid Definition Format

The `parse_grids()` function provides a compact string format for defining grids, making it easier to write tests and demos.

## Format Specification

```python
definitions = {
    "grid_id": "row1|row2|row3"
}
```

### Cell Types

Within each row, cells are separated by spaces. **Cell type is determined by the FIRST CHARACTER**, allowing multi-character content and grid references:

- **First char is digit (0-9)**: Create `Concrete` cells with entire string as content
  - `"1"` → `Concrete("1")`
  - `"123"` → `Concrete("123")`
  - `"5abc"` → `Concrete("5abc")`

- **First char is letter (a-zA-Z)**: Create `Ref` cells pointing to other grids (auto-determined primary status)
  - `"A"` → `Ref("A", is_primary=None)`
  - `"Main"` → `Ref("Main", is_primary=None)`
  - `"Grid2"` → `Ref("Grid2", is_primary=None)`
  - Multi-character grid IDs are fully supported!

- **First char is \***: Create primary `Ref` cells (explicitly marked), remainder is grid_id
  - `"*A"` → `Ref("A", is_primary=True)`
  - `"*Main"` → `Ref("Main", is_primary=True)`
  - `"*Grid2"` → `Ref("Grid2", is_primary=True)`
  - The `*` prefix explicitly marks this reference as the primary one

- **First char is ~**: Create secondary `Ref` cells (explicitly marked), remainder is grid_id
  - `"~A"` → `Ref("A", is_primary=False)`
  - `"~Main"` → `Ref("Main", is_primary=False)`
  - `"~Grid2"` → `Ref("Grid2", is_primary=False)`
  - The `~` prefix explicitly marks this reference as secondary

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

### Multi-character Content and Grid IDs

```python
store = parse_grids({
    "MainGrid": "100 200|abc Inner",
    "Inner": "x1 y2"
})
```

This creates:
- Grid "MainGrid": 2×2 with `[Concrete("100"), Concrete("200")], [Concrete("abc"), Ref("Inner")]`
- Grid "Inner": 1×2 with `[Concrete("x1"), Concrete("y2")]`

Note: Multi-character strings work seamlessly - first character determines the type!

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

Each referenced grid has exactly one **primary reference**. All other references to the same grid are **secondary**.

**Explicit marking** (recommended when you need specific behavior):
- Use `*<grid_id>` to explicitly mark a reference as primary
- Use `~<grid_id>` to explicitly mark a reference as secondary
- Example: `"*A B ~A"` creates two refs to "A" (first is primary, last is secondary) and one ref to "B"
- Works with multi-character grid IDs: `"*MainGrid ~OtherGrid"`

**Auto-determination** (default behavior):
- Use plain letters/names like `A` or `Main` for auto-determined primary status (`is_primary=None`)
- During the `analyze()` phase, the first reference encountered to each grid becomes primary
- All subsequent references to the same grid become secondary

When exiting a grid via a secondary reference, traversal teleports to the primary reference location before continuing.

**Example with explicit primary (single-char)**:
```python
store = parse_grids({
    "main": "~A B *A",  # Second ref to A is explicitly primary
    "A": "1|2",
    "B": "3"
})
```

**Example with explicit primary (multi-char)**:
```python
store = parse_grids({
    "Main": "~Portal Item *Portal",  # Second ref to Portal is explicitly primary
    "Portal": "100|200",
    "Item": "x"
})
```

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
