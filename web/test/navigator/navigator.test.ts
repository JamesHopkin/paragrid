/**
 * Tests for Navigator exit cycle detection.
 */

import { describe, it, expect } from 'vitest';
import { Navigator } from '../../src/lib/navigator/navigator.js';
import { Direction } from '../../src/lib/core/direction.js';
import { CellPosition } from '../../src/lib/core/position.js';
import { Ref, createGrid } from '../../src/lib/core/types.js';
import { createRuleSet } from '../../src/lib/operations/rules.js';

describe('TestNavigator', () => {
  it('test_exit_cycle_detection', () => {
    /**
     * Test that Navigator detects exit cycles and doesn't recurse infinitely.
     *
     * Create a grid structure where exiting forms a cycle:
     * Grid A contains a ref to B
     * Grid B contains a ref to A
     * Both grids are 1x1, so any movement hits an edge and tries to exit
     * This creates an exit cycle: A -> exit to B -> exit to A -> ...
     */
    const store = {
      A: createGrid('A', [[Ref('B', true)]]),
      B: createGrid('B', [[Ref('A', true)]]),
    };

    // Start in grid A
    const nav = new Navigator(store, new CellPosition('A', 0, 0), Direction.E);

    // Try to advance east - this should detect the exit cycle and return false
    // rather than recursing infinitely
    const result = nav.tryAdvance();

    expect(result).toBe(false); // Should detect exit cycle and return false
  });
});
