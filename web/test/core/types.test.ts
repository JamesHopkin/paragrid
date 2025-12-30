/**
 * Tests for basic grid data structures.
 */

import { describe, it, expect } from 'vitest';
import { Empty, Concrete, Ref, createGrid } from '../../src/lib/core/types.js';

describe('TestGridStructures', () => {
  it('test_empty_cell_creation', () => {
    const cell = Empty();
    expect(cell.type).toBe('empty');
  });

  it('test_concrete_cell_creation', () => {
    const cell = Concrete('test');
    expect(cell.type).toBe('concrete');
    expect(cell.id).toBe('test');
  });

  it('test_ref_cell_creation', () => {
    const cell = Ref('grid_id');
    expect(cell.type).toBe('ref');
    expect(cell.gridId).toBe('grid_id');
    expect(cell.isPrimary).toBe(null);
  });

  it('test_grid_creation', () => {
    const grid = createGrid('test_grid', [
      [Concrete('a'), Concrete('b')],
      [Concrete('c'), Concrete('d')],
    ]);
    expect(grid.id).toBe('test_grid');
    expect(grid.rows).toBe(2);
    expect(grid.cols).toBe(2);
  });

  it('test_grid_dimensions', () => {
    const grid = createGrid('test', [
      [Concrete('a'), Concrete('b'), Concrete('c')],
      [Concrete('d'), Concrete('e'), Concrete('f')],
    ]);
    expect(grid.rows).toBe(2);
    expect(grid.cols).toBe(3);
  });
});
