/**
 * Tests for the parse_grids function.
 */

import { describe, it, expect } from 'vitest';
import { parseGrids } from '../../src/lib/parser/parser.js';
import { Empty, Concrete, Ref, isConcrete, isEmpty, isRef } from '../../src/lib/core/types.js';

describe('TestParseGrids', () => {
  it('test_parse_simple_concrete_grid', () => {
    const definitions = {
      test: '1 2|3 4',
    };
    const store = parseGrids(definitions);

    expect(store.test).toBeDefined();
    const grid = store.test;
    expect(grid.id).toBe('test');
    expect(grid.rows).toBe(2);
    expect(grid.cols).toBe(2);

    // Check cells
    expect(isConcrete(grid.cells[0][0])).toBe(true);
    expect((grid.cells[0][0] as any).id).toBe('1');
    expect(isConcrete(grid.cells[0][1])).toBe(true);
    expect((grid.cells[0][1] as any).id).toBe('2');
    expect(isConcrete(grid.cells[1][0])).toBe(true);
    expect((grid.cells[1][0] as any).id).toBe('3');
    expect(isConcrete(grid.cells[1][1])).toBe(true);
    expect((grid.cells[1][1] as any).id).toBe('4');
  });

  it('test_parse_with_refs', () => {
    const definitions = {
      main: '1 A|2 3',
      A: '5 6',
    };
    const store = parseGrids(definitions);

    // Check main grid
    expect(store.main).toBeDefined();
    const main = store.main;
    expect(main.rows).toBe(2);
    expect(main.cols).toBe(2);
    expect(isConcrete(main.cells[0][0])).toBe(true);
    expect((main.cells[0][0] as any).id).toBe('1');
    expect(isRef(main.cells[0][1])).toBe(true);
    expect((main.cells[0][1] as any).gridId).toBe('A');

    // Check referenced grid
    expect(store.A).toBeDefined();
    const gridA = store.A;
    expect(gridA.rows).toBe(1);
    expect(gridA.cols).toBe(2);
  });

  it('test_parse_with_empty_cells', () => {
    const definitions = {
      test: '1  3|4 5 6',
    };
    const store = parseGrids(definitions);

    const grid = store.test;
    expect(grid.rows).toBe(2);
    expect(grid.cols).toBe(3);

    // First row: 1, Empty, 3
    expect(isConcrete(grid.cells[0][0])).toBe(true);
    expect((grid.cells[0][0] as any).id).toBe('1');
    expect(isEmpty(grid.cells[0][1])).toBe(true);
    expect(isConcrete(grid.cells[0][2])).toBe(true);
    expect((grid.cells[0][2] as any).id).toBe('3');
  });

  it('test_parse_with_underscore_empty', () => {
    const definitions = {
      test: '1 _|_ 2',
    };
    const store = parseGrids(definitions);

    const grid = store.test;
    expect(grid.rows).toBe(2);
    expect(grid.cols).toBe(2);

    expect(isConcrete(grid.cells[0][0])).toBe(true);
    expect((grid.cells[0][0] as any).id).toBe('1');
    expect(isEmpty(grid.cells[0][1])).toBe(true);
    expect(isEmpty(grid.cells[1][0])).toBe(true);
    expect(isConcrete(grid.cells[1][1])).toBe(true);
    expect((grid.cells[1][1] as any).id).toBe('2');
  });

  it('test_parse_multichar_concrete', () => {
    const definitions = {
      test: '123 456|789 012',
    };
    const store = parseGrids(definitions);

    const grid = store.test;
    expect(isConcrete(grid.cells[0][0])).toBe(true);
    expect((grid.cells[0][0] as any).id).toBe('123');
    expect(isConcrete(grid.cells[0][1])).toBe(true);
    expect((grid.cells[0][1] as any).id).toBe('456');
  });

  it('test_parse_multichar_refs', () => {
    const definitions = {
      main: 'SubGrid|OtherGrid',
      SubGrid: '1|2',
      OtherGrid: '3|4',
    };
    const store = parseGrids(definitions);

    const main = store.main;
    expect(isRef(main.cells[0][0])).toBe(true);
    expect((main.cells[0][0] as any).gridId).toBe('SubGrid');
    expect(isRef(main.cells[1][0])).toBe(true);
    expect((main.cells[1][0] as any).gridId).toBe('OtherGrid');
  });

  it('test_parse_explicit_primary_ref', () => {
    const definitions = {
      main: '*A 1',
      A: '2|3',
    };
    const store = parseGrids(definitions);

    const main = store.main;
    expect(isRef(main.cells[0][0])).toBe(true);
    const refCell = main.cells[0][0] as any;
    expect(refCell.gridId).toBe('A');
    expect(refCell.isPrimary).toBe(true);
  });

  it('test_parse_explicit_secondary_ref', () => {
    const definitions = {
      main: '~A 1',
      A: '2|3',
    };
    const store = parseGrids(definitions);

    const main = store.main;
    expect(isRef(main.cells[0][0])).toBe(true);
    const refCell = main.cells[0][0] as any;
    expect(refCell.gridId).toBe('A');
    expect(refCell.isPrimary).toBe(false);
  });

  it('test_parse_auto_determined_ref', () => {
    const definitions = {
      main: 'A 1',
      A: '2|3',
    };
    const store = parseGrids(definitions);

    const main = store.main;
    expect(isRef(main.cells[0][0])).toBe(true);
    const refCell = main.cells[0][0] as any;
    expect(refCell.gridId).toBe('A');
    expect(refCell.isPrimary).toBe(null); // Auto-determined
  });

  it('test_parse_case_sensitive_refs', () => {
    const definitions = {
      main: 'a A',
      a: '1|2',
      A: '3|4',
    };
    const store = parseGrids(definitions);

    const main = store.main;
    expect(isRef(main.cells[0][0])).toBe(true);
    expect((main.cells[0][0] as any).gridId).toBe('a');
    expect(isRef(main.cells[0][1])).toBe(true);
    expect((main.cells[0][1] as any).gridId).toBe('A');
    expect(store.a).toBeDefined();
    expect(store.A).toBeDefined();
  });

  it('test_parse_invalid_cell_raises_error', () => {
    const definitions = {
      test: '1 @invalid',
    };

    expect(() => parseGrids(definitions)).toThrow(/Invalid cell string/);
  });

  it('test_parse_inconsistent_row_length_raises_error', () => {
    const definitions = {
      test: '1 2|3 4 5',
    };

    expect(() => parseGrids(definitions)).toThrow(/Inconsistent row lengths/);
  });

  it('test_parse_single_row', () => {
    const definitions = {
      test: '1 2',
    };
    const store = parseGrids(definitions);

    const grid = store.test;
    expect(grid.rows).toBe(1);
    expect(grid.cols).toBe(2);
  });

  it('test_parse_single_column', () => {
    const definitions = {
      test: '1|2',
    };
    const store = parseGrids(definitions);

    const grid = store.test;
    expect(grid.rows).toBe(2);
    expect(grid.cols).toBe(1);
  });
});
