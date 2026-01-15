/**
 * Tests for depth-aware entry strategy with equivalent point transfer.
 */

import { describe, it, expect } from 'vitest';
import { Concrete, Empty, Ref, type GridStore } from '../../src/lib/core/types.js';
import { CellPosition } from '../../src/lib/core/position.js';
import { Direction } from '../../src/lib/core/direction.js';
import { push } from '../../src/lib/operations/push.js';
import { createRuleSet, RefStrategy } from '../../src/lib/operations/rules.js';
import { isPushFailure } from '../../src/lib/operations/failure.js';

describe('TestDepthAwareEntry', () => {
  it('test_equivalent_point_transfer_across_refs', () => {
    /**
     * Test that entry point preserves fractional position when exiting one ref and entering another.
     * Main has two refs A and B side by side, both occupying 5 rows
     * A is a single-column grid (forces immediate exit east)
     * Push from inside A (at row 0), exit, and enter B - should enter B at row 0, not middle
     */
    const store: GridStore = {
      main: {
        id: 'main',
        cells: [
          [Ref('A'), Ref('B')],
          [Empty(), Empty()],
          [Empty(), Empty()],
          [Empty(), Empty()],
          [Empty(), Empty()],
        ],
        rows: 5,
        cols: 2,
      },
      A: {
        id: 'A',
        cells: [
          [Concrete('X')], // X at A[0,0] (top row, only column)
          [Concrete('a')],
          [Concrete('b')],
          [Concrete('c')],
          [Concrete('d')],
        ],
        rows: 5,
        cols: 1,
      },
      B: {
        id: 'B',
        cells: [
          [Empty(), Concrete('1')],
          [Empty(), Concrete('2')],
          [Empty(), Concrete('3')],
          [Empty(), Concrete('4')],
          [Empty(), Concrete('5')],
        ],
        rows: 5,
        cols: 2,
      },
    };

    // Push eastward from A[0,0] (row 0 of A)
    // Path: A[0,0] -> [hit east edge, exit A] -> main[0,1] (Ref B) -> [enter B] -> B[0,0]
    // Equivalent point: exited at fraction 0.0 (row 0 of 5), enter at fraction 0.0 (row 0 of 5)
    const result = push(
      store,
      new CellPosition('A', 0, 0),
      Direction.E,
      createRuleSet(RefStrategy.TRY_ENTER_FIRST)
    );

    expect(isPushFailure(result)).toBe(false);

    if (!isPushFailure(result)) {
      // The entry should be at B[0,0] (top row), not B[2,0] (middle row)
      // Verify by checking where X ended up in grid B
      const gridB = result.store.B;
      // X should be at row 0, column 0 (equivalent point transfer - same depth)
      expect(gridB.cells[0][0].type).toBe('concrete');
      if (gridB.cells[0][0].type === 'concrete') {
        expect(gridB.cells[0][0].id).toBe('X');
      }
    }
  });

  it('test_standard_entry_when_no_prior_exit', () => {
    /**
     * Test that standard middle-of-edge entry is used when entering without prior exit.
     * When entering a ref directly from main (no prior exit at same depth)
     * Should use standard middle-of-edge entry
     */
    const store: GridStore = {
      main: {
        id: 'main',
        cells: [
          [Concrete('9'), Ref('A'), Empty()],
          [Empty(), Empty(), Empty()],
          [Empty(), Empty(), Empty()],
        ],
        rows: 3,
        cols: 3,
      },
      A: {
        id: 'A',
        cells: [
          [Concrete('1'), Concrete('2'), Concrete('3')],
          [Concrete('4'), Concrete('5'), Concrete('6')],
          [Concrete('7'), Concrete('8'), Concrete('9')],
        ],
        rows: 3,
        cols: 3,
      },
    };

    // Push eastward from main[0,0] (row 0)
    // No prior exit, so use standard middle entry
    const result = push(
      store,
      new CellPosition('main', 0, 0),
      Direction.E,
      createRuleSet(RefStrategy.TRY_ENTER_FIRST)
    );

    expect(isPushFailure(result)).toBe(false);

    if (!isPushFailure(result)) {
      // When entering A from main (no prior exit), use standard middle entry
      // A has 3 rows, so middle is row 1
      const gridA = result.store.A;
      // 9 should be at row 1 (middle, standard entry)
      expect(gridA.cells[1][0].type).toBe('concrete');
      if (gridA.cells[1][0].type === 'concrete') {
        expect(gridA.cells[1][0].id).toBe('9');
      }
    }
  });

  it('test_equivalent_point_bottom_row', () => {
    /**
     * Test equivalent point transfer from bottom row.
     * Push from bottom row of A, should enter B at bottom row
     * A is a single-column grid (forces immediate exit east)
     */
    const store: GridStore = {
      main: {
        id: 'main',
        cells: [
          [Ref('A'), Ref('B')],
          [Empty(), Empty()],
          [Empty(), Empty()],
          [Empty(), Empty()],
          [Empty(), Empty()],
        ],
        rows: 5,
        cols: 2,
      },
      A: {
        id: 'A',
        cells: [
          [Concrete('a')],
          [Concrete('b')],
          [Concrete('c')],
          [Concrete('d')],
          [Concrete('X')], // X at A[4,0] (bottom row, only column)
        ],
        rows: 5,
        cols: 1,
      },
      B: {
        id: 'B',
        cells: [
          [Empty(), Concrete('1')],
          [Empty(), Concrete('2')],
          [Empty(), Concrete('3')],
          [Empty(), Concrete('4')],
          [Empty(), Concrete('5')],
        ],
        rows: 5,
        cols: 2,
      },
    };

    // Push eastward from A[4,0] (bottom row of A)
    // Path: A[4,0] -> [hit east edge, exit A] -> main[0,1] (Ref B) -> [enter B] -> B[4,0]
    // Equivalent point: exited at fraction 1.0 (row 4 of 5), enter at fraction 1.0 (row 4 of 5)
    const result = push(
      store,
      new CellPosition('A', 4, 0),
      Direction.E,
      createRuleSet(RefStrategy.TRY_ENTER_FIRST)
    );

    expect(isPushFailure(result)).toBe(false);

    if (!isPushFailure(result)) {
      // X should enter B at bottom row (row 4), not middle (row 2)
      const gridB = result.store.B;
      expect(gridB.cells[4][0].type).toBe('concrete');
      if (gridB.cells[4][0].type === 'concrete') {
        expect(gridB.cells[4][0].id).toBe('X');
      }
    }
  });

  it('test_equivalent_point_4_to_2_rows', () => {
    /**
     * Test equivalent point transfer from 4-row grid to 2-row grid (multiple).
     * A has 4 rows, B has 2 rows
     * Exit from row 3 (bottom) of A = fraction 1.0
     * Should enter B at row 1 (bottom) = round(1.0 * 1) = 1
     */
    const store: GridStore = {
      main: {
        id: 'main',
        cells: [[Ref('A'), Ref('B')]],
        rows: 1,
        cols: 2,
      },
      A: {
        id: 'A',
        cells: [[Concrete('a')], [Concrete('b')], [Concrete('c')], [Concrete('X')]], // X at A[3,0] (bottom row)
        rows: 4,
        cols: 1,
      },
      B: {
        id: 'B',
        cells: [
          [Empty(), Concrete('1')],
          [Empty(), Concrete('2')],
        ],
        rows: 2,
        cols: 2,
      },
    };

    const result = push(
      store,
      new CellPosition('A', 3, 0),
      Direction.E,
      createRuleSet(RefStrategy.TRY_ENTER_FIRST)
    );

    expect(isPushFailure(result)).toBe(false);

    if (!isPushFailure(result)) {
      // Fraction 1.0 maps to row 1 in 2-row grid
      const gridB = result.store.B;
      expect(gridB.cells[1][0].type).toBe('concrete');
      if (gridB.cells[1][0].type === 'concrete') {
        expect(gridB.cells[1][0].id).toBe('X');
      }
    }
  });

  it('test_equivalent_point_2_to_4_rows', () => {
    /**
     * Test ancestor-based entry from 2-row grid to 4-row grid.
     * A has 2 rows, B has 4 rows
     * Exit from row 1 (bottom) of A: center = 2/3 ≈ 0.667
     * Maps to row 2 in B (center 3/5 = 0.6, nearest to 0.667)
     */
    const store: GridStore = {
      main: {
        id: 'main',
        cells: [[Ref('A'), Ref('B')]],
        rows: 1,
        cols: 2,
      },
      A: {
        id: 'A',
        cells: [
          [Concrete('a')],
          [Concrete('X')], // X at A[1,0] (bottom row)
        ],
        rows: 2,
        cols: 1,
      },
      B: {
        id: 'B',
        cells: [
          [Empty(), Concrete('1')],
          [Empty(), Concrete('2')],
          [Empty(), Concrete('3')],
          [Empty(), Concrete('4')],
        ],
        rows: 4,
        cols: 2,
      },
    };

    const result = push(
      store,
      new CellPosition('A', 1, 0),
      Direction.E,
      createRuleSet(RefStrategy.TRY_ENTER_FIRST)
    );

    expect(isPushFailure(result)).toBe(false);

    if (!isPushFailure(result)) {
      // Center 2/3 ≈ 0.667 maps to row 2 in 4-row grid (center 3/5 = 0.6)
      const gridB = result.store.B;
      expect(gridB.cells[2][0].type).toBe('concrete');
      if (gridB.cells[2][0].type === 'concrete') {
        expect(gridB.cells[2][0].id).toBe('X');
      }
    }
  });

  it('test_equivalent_point_3_to_5_rows', () => {
    /**
     * Test ancestor-based entry from 3-row grid to 5-row grid.
     * A has 3 rows, B has 5 rows
     * Exit from row 2 (bottom) of A: center = 3/4 = 0.75
     * Maps to row 3 in B (center 4/6 ≈ 0.667, nearest to 0.75)
     */
    const store: GridStore = {
      main: {
        id: 'main',
        cells: [[Ref('A'), Ref('B')]],
        rows: 1,
        cols: 2,
      },
      A: {
        id: 'A',
        cells: [
          [Concrete('a')],
          [Concrete('b')],
          [Concrete('X')], // X at A[2,0] (bottom row)
        ],
        rows: 3,
        cols: 1,
      },
      B: {
        id: 'B',
        cells: [
          [Empty(), Concrete('1')],
          [Empty(), Concrete('2')],
          [Empty(), Concrete('3')],
          [Empty(), Concrete('4')],
          [Empty(), Concrete('5')],
        ],
        rows: 5,
        cols: 2,
      },
    };

    const result = push(
      store,
      new CellPosition('A', 2, 0),
      Direction.E,
      createRuleSet(RefStrategy.TRY_ENTER_FIRST)
    );

    expect(isPushFailure(result)).toBe(false);

    if (!isPushFailure(result)) {
      // Center 3/4 = 0.75 maps to row 3 in 5-row grid (center 4/6 ≈ 0.667)
      const gridB = result.store.B;
      expect(gridB.cells[3][0].type).toBe('concrete');
      if (gridB.cells[3][0].type === 'concrete') {
        expect(gridB.cells[3][0].id).toBe('X');
      }
    }
  });

  it('test_equivalent_point_5_to_3_rows', () => {
    /**
     * Test equivalent point transfer from 5-row grid to 3-row grid (reverse unrelated).
     * A has 5 rows, B has 3 rows
     * Exit from row 4 (bottom) of A = fraction 1.0
     * Should enter B at row 2 (bottom) = round(1.0 * 2) = 2
     */
    const store: GridStore = {
      main: {
        id: 'main',
        cells: [[Ref('A'), Ref('B')]],
        rows: 1,
        cols: 2,
      },
      A: {
        id: 'A',
        cells: [
          [Concrete('a')],
          [Concrete('b')],
          [Concrete('c')],
          [Concrete('d')],
          [Concrete('X')], // X at A[4,0] (bottom row)
        ],
        rows: 5,
        cols: 1,
      },
      B: {
        id: 'B',
        cells: [
          [Empty(), Concrete('1')],
          [Empty(), Concrete('2')],
          [Empty(), Concrete('3')],
        ],
        rows: 3,
        cols: 2,
      },
    };

    const result = push(
      store,
      new CellPosition('A', 4, 0),
      Direction.E,
      createRuleSet(RefStrategy.TRY_ENTER_FIRST)
    );

    expect(isPushFailure(result)).toBe(false);

    if (!isPushFailure(result)) {
      // Fraction 1.0 maps to row 2 in 3-row grid
      const gridB = result.store.B;
      expect(gridB.cells[2][0].type).toBe('concrete');
      if (gridB.cells[2][0].type === 'concrete') {
        expect(gridB.cells[2][0].id).toBe('X');
      }
    }
  });

  it('test_equivalent_point_3_to_5_middle_row', () => {
    /**
     * Test equivalent point transfer from middle row with unrelated dimensions.
     * A has 3 rows, B has 5 rows
     * Exit from row 1 (middle) of A = fraction 0.5
     * Should enter B at row 2 (middle) = round(0.5 * 4) = 2
     */
    const store: GridStore = {
      main: {
        id: 'main',
        cells: [[Ref('A'), Ref('B')]],
        rows: 1,
        cols: 2,
      },
      A: {
        id: 'A',
        cells: [
          [Concrete('a')],
          [Concrete('X')], // X at A[1,0] (middle row)
          [Concrete('c')],
        ],
        rows: 3,
        cols: 1,
      },
      B: {
        id: 'B',
        cells: [
          [Empty(), Concrete('1')],
          [Empty(), Concrete('2')],
          [Empty(), Concrete('3')],
          [Empty(), Concrete('4')],
          [Empty(), Concrete('5')],
        ],
        rows: 5,
        cols: 2,
      },
    };

    const result = push(
      store,
      new CellPosition('A', 1, 0),
      Direction.E,
      createRuleSet(RefStrategy.TRY_ENTER_FIRST)
    );

    expect(isPushFailure(result)).toBe(false);

    if (!isPushFailure(result)) {
      // Fraction 0.5 maps to row 2 in 5-row grid
      const gridB = result.store.B;
      expect(gridB.cells[2][0].type).toBe('concrete');
      if (gridB.cells[2][0].type === 'concrete') {
        expect(gridB.cells[2][0].id).toBe('X');
      }
    }
  });

  it('test_equivalent_point_5_to_3_middle_row', () => {
    /**
     * Test equivalent point transfer from middle row, reverse direction.
     * A has 5 rows, B has 3 rows
     * Exit from row 2 (middle) of A = fraction 0.5
     * Should enter B at row 1 (middle) = round(0.5 * 2) = 1
     */
    const store: GridStore = {
      main: {
        id: 'main',
        cells: [[Ref('A'), Ref('B')]],
        rows: 1,
        cols: 2,
      },
      A: {
        id: 'A',
        cells: [
          [Concrete('a')],
          [Concrete('b')],
          [Concrete('X')], // X at A[2,0] (middle row)
          [Concrete('d')],
          [Concrete('e')],
        ],
        rows: 5,
        cols: 1,
      },
      B: {
        id: 'B',
        cells: [
          [Empty(), Concrete('1')],
          [Empty(), Concrete('2')],
          [Empty(), Concrete('3')],
        ],
        rows: 3,
        cols: 2,
      },
    };

    const result = push(
      store,
      new CellPosition('A', 2, 0),
      Direction.E,
      createRuleSet(RefStrategy.TRY_ENTER_FIRST)
    );

    expect(isPushFailure(result)).toBe(false);

    if (!isPushFailure(result)) {
      // Fraction 0.5 maps to row 1 in 3-row grid
      const gridB = result.store.B;
      expect(gridB.cells[1][0].type).toBe('concrete');
      if (gridB.cells[1][0].type === 'concrete') {
        expect(gridB.cells[1][0].id).toBe('X');
      }
    }
  });
});
