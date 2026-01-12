# Test Coverage Guide

## Current Status

**Overall Coverage: 89%** (591 statements, 66 missed lines)

Last updated: 2026-01-12

## Running Coverage Tests

### Quick Coverage Check
```bash
cd python
source venv/bin/activate
python -m pytest test_paragrid.py test_push_rotational.py --cov=paragrid --cov-report=term-missing -q
```

### Detailed HTML Report
```bash
cd python
source venv/bin/activate
python -m pytest test_paragrid.py test_push_rotational.py --cov=paragrid --cov-report=html
# Open htmlcov/index.html in browser
```

### Coverage for Specific Test File
```bash
# Just original tests
python -m pytest test_paragrid.py --cov=paragrid --cov-report=term-missing

# Just rotational tests
python -m pytest test_push_rotational.py --cov=paragrid --cov-report=term-missing
```

### Show Only Missing Lines (Skip Covered)
```bash
python -m pytest --cov=paragrid --cov-report=term-missing:skip-covered -q
```

## Missing Coverage (71 lines)

### 1. Focus Metadata Edge Cases (Lines 330, 332, 334, 341, 365)
**Location**: `analyze()` function - focus path tracking
**What's missing**: Edge cases in focus offset calculation
- Line 330: `if focus_path is None or current_path is None`
- Line 332: `if len(current_path) >= len(focus_path)`
- Line 334: `if focus_path[: len(current_path)] != current_path`
- Line 341: `return None` (when ref to next grid not found)
- Line 365: `return depth, None` (when ref position not found)

**Why not covered**: Tests use `focus_path=None` or simple matching paths. Need tests with:
- Mismatched paths (divergent hierarchies)
- Paths where refs don't exist in expected positions

**Strategy**: Add tests with complex focus paths that diverge or have missing refs.

---

### 2. Ref Primary/Secondary Edge Cases (Lines 427-428) ✅ Mostly Done
**Location**: `analyze()` function - ref analysis
**What's missing**:
- ✅ Line 400-401: Explicitly marked primary refs (`is_primary=True`) - COVERED
- ✅ Line 404: Explicitly marked non-primary refs (`is_primary=False`) - COVERED
- Line 427-428: Unknown cell type error handler (defensive code, unreachable)

**Status**: Added tests `test_analyze_explicit_is_primary_true` and `test_analyze_explicit_is_primary_false` that exercise the explicit is_primary feature

---

### 3. Navigator Ref Chain Cycle Detection (Lines 597, 601, 615, 636-668, 672-673)
**Location**: `Navigator.try_enter_multi()` and related
**What's missing**: Entry through chained Refs that form cycles

**Lines breakdown**:
- 597, 601, 615: Branches in position advancement
- 636-668: `try_enter_multi()` - follows Ref chains, detects cycles
- 672-673: `enter_multi()` assertion wrapper

**Why not covered**: Tests don't have Ref→Ref→Ref chains that cycle back.

**Strategy**: Create test with:
```python
grids = {
    "A": "B 1",
    "B": "C 2",
    "C": "A 3"  # Cycles back
}
```
Push through the chain to hit cycle detection.

---

### 4. Depth-Aware Entry for W/S/N Directions (Lines 783, 807, 810-838)
**Location**: `try_enter()` function - depth-aware entry positioning
**What's missing**: Entry from West, South, North with depth-aware positioning

**Lines breakdown**:
- 783: Edge detection for position storage
- 807: Return for Direction.E with single row
- 810-838: Entry logic for W, S, N directions with depth-aware positioning

**Why not covered**: Most tests enter from East, and depth-aware entry requires specific setup with:
- Prior exit from a grid (sets `exit_position`, `exit_depth`, `exit_fraction`)
- Re-entry through different ref with matching depth

**Strategy**: Create test that:
1. Exits grid A through a ref
2. Re-enters grid A through different ref from W/S/N
3. Uses depth-aware positioning based on exit point

---

### 5. Push Edge Cases (Lines 855, 898, 923, 952, 969, 974)
**Location**: `push_simple()` and `push()` functions
**What's missing**:

- **Line 855**: `if max_depth <= 0` - depth limit hit
- **Line 898**: Path length check for path cycle detection
- **Line 923**: Strategy type check for swallow
- **Line 952**: Cell check in push
- **Line 969**: Empty path handling
- **Line 974**: Immediate failure return

**Strategy**:
- Add test with `max_depth=1` that hits limit
- Add test that creates path cycles (but not to start)
- Most are defensive/edge cases

---

### 6. Push Cycle to Start (Lines 1033, 1219-1225)
**Location**: `push_simple()` - cycle detection
**What's missing**: Path that cycles back to starting position (success case)

**Why not covered**: This is a valid push pattern where the path wraps around and ends where it started.

**Strategy**: Create a grid layout where pushing in a direction cycles back:
```python
# Grid with wrapping refs that cycle back to start
grids = {
    "main": "1 2 3|PORTAL _ _|_ _ _",
    # Portal that leads back to start position
}
```

---

### 7. Navigator Exit/Try-Advance Edge Cases (Lines 1179, 1184, 1194)
**Location**: `Navigator` exit and advancement
**What's missing**:
- Line 1179: Exit attempt fails (no parent ref)
- Line 1184: Exit cycle detection
- Line 1194: Exit fails in try_advance

**Why not covered**: Tests don't create scenarios where exit fails or cycles.

**Strategy**:
- Create grid with no parent ref (root grid) and try to exit
- Create mutual ref cycle that causes exit cycling

---

### 8. Max Depth Failure in Push_Simple (Line 1270)
**Location**: `push_simple()` function
**What's missing**: Max depth exceeded failure case
```python
return PushFailure("MAX_DEPTH", nav.current, f"Exceeded maximum depth of {max_depth}")
```

**Why not covered**: Tests don't push with small `max_depth` that gets exceeded.

**Strategy**: Create test with long push path and `max_depth=2` or similar.

---

### 9. Find Cell With Tag Utility (Lines 1394-1399)
**Location**: `find_cell_with_tag()` helper function
**What's missing**: This utility function isn't called by any tests
```python
def find_cell_with_tag(store: GridStore, tag: str, tag_fn: TagFn) -> CellPosition | None:
    for grid in store.values():
        for row_idx, row in enumerate(grid.cells):
            for col_idx, cell in enumerate(row):
                if tag in tag_fn(cell):
                    return CellPosition(grid.id, row_idx, col_idx)
    return None
```

**Why not covered**: This is a utility function that's not currently used in the main code paths.

**Strategy**: Either:
- Delete if unused
- Add tests if it's part of public API
- Mark as utility for future use

---

## Quick Wins for Coverage

1. **Add N/S/W directional tests** ✅ (Done via rotational framework - gained 6 lines!)
2. **Add explicit primary/secondary ref tests** (Lines 400-401, 404)
3. **Add max_depth tests** (Line 855)
4. **Add cycle-to-start test** (Lines 1219-1225)
5. **Add Ref chain cycle test** (Lines 636-668)

## Testing Strategy

### Rotational Test Framework
Use the rotational test framework in `test_rotations.py` for any directional tests:
- Write test once for Direction.E
- Automatically tests N, S, W via rotation
- Already increased coverage by 1% with example tests!

### Adding Tests
1. Identify uncovered lines in this document
2. Create minimal test case that hits those lines
3. Use rotational framework if directional
4. Run coverage to verify

### Unreachable Code
Some lines may be defensive programming (error handlers for "impossible" states). Consider adding:
```python
assert False, "unreachable: [explanation]"
```

## Goal: 100% Coverage

To hit 100%, we need to systematically address each of the 9 categories above. Focus on:
1. **Ref chain cycles** (biggest chunk: ~40 lines) - Lines 636-668
2. **Depth-aware entry W/S/N** (~30 lines) - Lines 810-838
3. **Focus metadata edge cases** (~5 lines) - Lines 330-365
4. **Push cycle to start** (~7 lines) - Lines 1219-1225
5. **Misc edge cases** (remaining ~10 lines)

Most remaining gaps are legitimate edge cases worth testing, not unreachable code.

## Missing Lines Summary

| Category | Line Count | Difficulty | Priority | Status |
|----------|------------|------------|----------|--------|
| Ref chain cycle detection | ~33 | Medium | High | ⏳ TODO |
| Depth-aware entry (W/S/N) | ~30 | Hard | Medium | ⏳ TODO |
| Push cycle to start | ~7 | Medium | High | ⏳ TODO |
| Focus metadata edge cases | ~6 | Easy | Medium | ⏳ TODO |
| ~~Explicit primary/secondary refs~~ | ~~4~~ | Easy | High | ✅ DONE |
| Navigator exit/advance edges | ~5 | Medium | Low | ⏳ TODO |
| find_cell_with_tag utility | ~6 | N/A | Low (unused?) | ⏳ TODO |
| Misc push edge cases | ~8 | Easy | Medium | ⏳ TODO |
| try_enter edge cases | ~~1~~ | Easy | Medium | ✅ DONE |
| **Total** | **~66** | | | **-5 lines** |

### Priority Explanation
- **High**: Easy to test and/or frequently used code paths
- **Medium**: Moderate effort, good coverage value
- **Low**: Defensive code or rarely-used utilities

## Next Steps

1. ✅ Add rotational test framework (Done! +6 lines)
2. ✅ Add explicit primary/secondary ref tests (Done! +4 lines, easy)
3. ✅ Add try_enter error handling test (Done! +1 line, easy)
4. ✅ Replace unreachable early outs with assertions (Done! Clearer invariants)
5. 🎯 Add max_depth edge case test (+1 line, easy)
6. 🎯 Add cycle-to-start test (+7 lines, medium)
7. 🔧 Add Ref chain cycle tests (+33 lines, medium)
8. 🔧 Add depth-aware W/S/N entry tests (+30 lines, hard)

**Estimated effort to 100%**: 10-15 well-designed test cases

## Recent Changes (2026-01-12)

### Early Out Cleanup (+1% coverage, -5 lines)

**Phase 1: Converted defensive early outs to assertions**
- Line 331: Focus path None checks → Assert (documents invariant)
- Line 856: Unknown direction fallback → Assert (enum is exhaustive)
- Line 901: Strategy type default → Assert (enum is exhaustive)

**Phase 2: Added high-value tests**
- Lines 400-401, 404: Added `test_analyze_explicit_is_primary_true` and `test_analyze_explicit_is_primary_false` (+4 lines)
  - Tests the explicit `Ref(grid_id, is_primary=True/False)` API feature
  - Documents an intentional API surface, not defensive code

**Phase 3: Added error handling test**
- Line 782: Added `test_try_enter_nonexistent_grid` (+1 line)
  - Tests graceful handling of Ref pointing to non-existent grid
  - Legitimate error case for malformed user data

**Result**: Improved coverage from 88% → 89%, reduced missing lines from 71 → 66
