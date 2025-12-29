/**
 * Comprehensive test suite for the Paragrid visualization system.
 * Ported from Python test_paragrid.py
 */

import { describe, it, expect } from 'vitest';
import {
  Cell,
  CellNode,
  CellPosition,
  Concrete,
  ConcreteNode,
  CutoffNode,
  Direction,
  Empty,
  EmptyNode,
  Fraction,
  Grid,
  GridStore,
  NestedNode,
  Ref,
  RefNode,
  TerminationReason,
  analyze,
  findPrimaryRef,
  parseGrids,
  push,
  pushSimple,
  traverse,
  getCell,
} from './paragrid';

// =============================================================================
// Test Grid Data Structures
// =============================================================================

describe('TestGridStructures', () => {
  it('test_empty_cell_creation', () => {
    const cell = new Empty();
    expect(cell).toBeInstanceOf(Empty);
  });

  it('test_concrete_cell_creation', () => {
    const cell = new Concrete('test');
    expect(cell).toBeInstanceOf(Concrete);
    expect(cell.id).toBe('test');
  });

  it('test_ref_cell_creation', () => {
    const cell = new Ref('grid_id');
    expect(cell).toBeInstanceOf(Ref);
    expect(cell.gridId).toBe('grid_id');
  });

  it('test_grid_creation', () => {
    const grid = new Grid('test_grid', [
      [new Concrete('a'), new Concrete('b')],
      [new Concrete('c'), new Concrete('d')],
    ]);
    expect(grid.id).toBe('test_grid');
    expect(grid.rows).toBe(2);
    expect(grid.cols).toBe(2);
  });

  it('test_grid_dimensions', () => {
    const grid = new Grid('test', [
      [new Concrete('a'), new Concrete('b'), new Concrete('c')],
      [new Concrete('d'), new Concrete('e'), new Concrete('f')],
    ]);
    expect(grid.rows).toBe(2);
    expect(grid.cols).toBe(3);
  });
});

// =============================================================================
// Test String Parsing
// =============================================================================

describe('TestParseGrids', () => {
  it('test_parse_simple_concrete_grid', () => {
    const definitions = {
      test: '1 2|3 4',
    };
    const store = parseGrids(definitions);

    expect(store.has('test')).toBe(true);
    const grid = store.get('test')!;
    expect(grid.id).toBe('test');
    expect(grid.rows).toBe(2);
    expect(grid.cols).toBe(2);

    // Check cells
    expect(grid.cells[0][0]).toBeInstanceOf(Concrete);
    expect((grid.cells[0][0] as Concrete).id).toBe('1');
    expect(grid.cells[0][1]).toBeInstanceOf(Concrete);
    expect((grid.cells[0][1] as Concrete).id).toBe('2');
    expect(grid.cells[1][0]).toBeInstanceOf(Concrete);
    expect((grid.cells[1][0] as Concrete).id).toBe('3');
    expect(grid.cells[1][1]).toBeInstanceOf(Concrete);
    expect((grid.cells[1][1] as Concrete).id).toBe('4');
  });

  it('test_parse_with_refs', () => {
    const definitions = {
      main: '1 A|2 3',
      A: '5 6',
    };
    const store = parseGrids(definitions);

    // Check main grid
    expect(store.has('main')).toBe(true);
    const main = store.get('main')!;
    expect(main.rows).toBe(2);
    expect(main.cols).toBe(2);
    expect(main.cells[0][0]).toBeInstanceOf(Concrete);
    expect((main.cells[0][0] as Concrete).id).toBe('1');
    expect(main.cells[0][1]).toBeInstanceOf(Ref);
    expect((main.cells[0][1] as Ref).gridId).toBe('A');

    // Check referenced grid
    expect(store.has('A')).toBe(true);
    const gridA = store.get('A')!;
    expect(gridA.rows).toBe(1);
    expect(gridA.cols).toBe(2);
  });

  it('test_parse_with_empty_cells', () => {
    const definitions = {
      test: '1  3|4 5 6',
    };
    const store = parseGrids(definitions);

    const grid = store.get('test')!;
    expect(grid.rows).toBe(2);
    expect(grid.cols).toBe(3);

    // First row: 1, Empty, 3
    expect(grid.cells[0][0]).toBeInstanceOf(Concrete);
    expect((grid.cells[0][0] as Concrete).id).toBe('1');
    expect(grid.cells[0][1]).toBeInstanceOf(Empty);
    expect(grid.cells[0][2]).toBeInstanceOf(Concrete);
    expect((grid.cells[0][2] as Concrete).id).toBe('3');
  });

  it('test_parse_with_underscore_empty', () => {
    const definitions = {
      test: '1 _|_ 2',
    };
    const store = parseGrids(definitions);

    const grid = store.get('test')!;
    expect(grid.rows).toBe(2);
    expect(grid.cols).toBe(2);

    expect(grid.cells[0][0]).toBeInstanceOf(Concrete);
    expect(grid.cells[0][1]).toBeInstanceOf(Empty);
    expect(grid.cells[1][0]).toBeInstanceOf(Empty);
    expect(grid.cells[1][1]).toBeInstanceOf(Concrete);
  });

  it('test_parse_multiple_grids', () => {
    const definitions = {
      grid1: '1 2',
      grid2: '3|4',
      grid3: 'A B|C D',
    };
    const store = parseGrids(definitions);

    expect(store.size).toBe(3);
    expect(store.has('grid1')).toBe(true);
    expect(store.has('grid2')).toBe(true);
    expect(store.has('grid3')).toBe(true);

    // Check grid1
    expect(store.get('grid1')!.rows).toBe(1);
    expect(store.get('grid1')!.cols).toBe(2);

    // Check grid2
    expect(store.get('grid2')!.rows).toBe(2);
    expect(store.get('grid2')!.cols).toBe(1);

    // Check grid3 has refs
    expect(store.get('grid3')!.cells[0][0]).toBeInstanceOf(Ref);
    expect((store.get('grid3')!.cells[0][0] as Ref).gridId).toBe('A');
  });

  it('test_parse_single_row', () => {
    const definitions = {
      row: '1 2 3 4',
    };
    const store = parseGrids(definitions);

    const grid = store.get('row')!;
    expect(grid.rows).toBe(1);
    expect(grid.cols).toBe(4);
  });

  it('test_parse_single_column', () => {
    const definitions = {
      col: '1|2|3|4',
    };
    const store = parseGrids(definitions);

    const grid = store.get('col')!;
    expect(grid.rows).toBe(4);
    expect(grid.cols).toBe(1);
  });

  it('test_parse_case_sensitive_refs', () => {
    const definitions = {
      test: 'A a|B b',
    };
    const store = parseGrids(definitions);

    const grid = store.get('test')!;
    // Both should be Refs, but with different grid_ids
    expect(grid.cells[0][0]).toBeInstanceOf(Ref);
    expect((grid.cells[0][0] as Ref).gridId).toBe('A');
    expect(grid.cells[0][1]).toBeInstanceOf(Ref);
    expect((grid.cells[0][1] as Ref).gridId).toBe('a');
  });

  it('test_parse_explicit_primary_ref', () => {
    const definitions = {
      test: '1 *A|2 3',
    };
    const store = parseGrids(definitions);

    const grid = store.get('test')!;
    // Check that *A creates a Ref with isPrimary=true
    expect(grid.cells[0][1]).toBeInstanceOf(Ref);
    expect((grid.cells[0][1] as Ref).gridId).toBe('A');
    expect((grid.cells[0][1] as Ref).isPrimary).toBe(true);
  });

  it('test_parse_explicit_secondary_ref', () => {
    const definitions = {
      test: '~A 1|2 3',
    };
    const store = parseGrids(definitions);

    const grid = store.get('test')!;
    // Check that ~A creates a Ref with isPrimary=false
    expect(grid.cells[0][0]).toBeInstanceOf(Ref);
    expect((grid.cells[0][0] as Ref).gridId).toBe('A');
    expect((grid.cells[0][0] as Ref).isPrimary).toBe(false);
  });

  it('test_parse_auto_determined_ref', () => {
    const definitions = {
      test: '1 A|2 3',
    };
    const store = parseGrids(definitions);

    const grid = store.get('test')!;
    // Check that A creates a Ref with isPrimary=null
    expect(grid.cells[0][1]).toBeInstanceOf(Ref);
    expect((grid.cells[0][1] as Ref).gridId).toBe('A');
    expect((grid.cells[0][1] as Ref).isPrimary).toBe(null);
  });

  it('test_parse_mixed_primary_markers', () => {
    const definitions = {
      test: '*A ~A A|~B B *B',
    };
    const store = parseGrids(definitions);

    const grid = store.get('test')!;
    // First row: *A (primary), ~A (secondary), A (auto)
    expect(grid.cells[0][0]).toBeInstanceOf(Ref);
    expect((grid.cells[0][0] as Ref).isPrimary).toBe(true);
    expect(grid.cells[0][1]).toBeInstanceOf(Ref);
    expect((grid.cells[0][1] as Ref).isPrimary).toBe(false);
    expect(grid.cells[0][2]).toBeInstanceOf(Ref);
    expect((grid.cells[0][2] as Ref).isPrimary).toBe(null);
    // Second row: ~B (secondary), B (auto), *B (primary)
    expect(grid.cells[1][0]).toBeInstanceOf(Ref);
    expect((grid.cells[1][0] as Ref).isPrimary).toBe(false);
    expect(grid.cells[1][1]).toBeInstanceOf(Ref);
    expect((grid.cells[1][1] as Ref).isPrimary).toBe(null);
    expect(grid.cells[1][2]).toBeInstanceOf(Ref);
    expect((grid.cells[1][2] as Ref).isPrimary).toBe(true);
  });

  it('test_parse_invalid_cell_raises_error', () => {
    const definitions = {
      bad: '1 @ 2',
    };
    expect(() => parseGrids(definitions)).toThrow(/Invalid cell string/);
  });

  it('test_parse_invalid_cell_error_details', () => {
    const definitions = {
      TestGrid: '1 2|3 @ 5',
    };
    try {
      parseGrids(definitions);
      expect.fail('Should have raised error');
    } catch (e: any) {
      const errorMsg = e.message;
      // Verify all diagnostic information is present
      expect(errorMsg).toContain("Invalid cell string: '@'");
      expect(errorMsg).toContain("Grid: 'TestGrid'");
      expect(errorMsg).toContain('Row 1:');
      expect(errorMsg).toContain('Position: column 1');
      expect(errorMsg).toContain('Valid formats:');
      expect(errorMsg).toContain('Digit start');
      expect(errorMsg).toContain('Letter start');
    }
  });

  it('test_parse_inconsistent_row_length_raises_error', () => {
    const definitions = {
      bad: '1 2|3 4 5',
    };
    expect(() => parseGrids(definitions)).toThrow(/same number of cells/);
  });

  it('test_parse_inconsistent_row_length_error_details', () => {
    const definitions = {
      TestGrid: '1 2|3 4 5|6 7',
    };
    try {
      parseGrids(definitions);
      expect.fail('Should have raised error');
    } catch (e: any) {
      const errorMsg = e.message;
      // Verify diagnostic information is present
      expect(errorMsg).toContain("Inconsistent row lengths in grid 'TestGrid'");
      expect(errorMsg).toContain('Expected: 2 columns');
      expect(errorMsg).toContain('Mismatched rows:');
      expect(errorMsg).toContain('Row 1: 3 columns');
    }
  });

  it('test_parse_multichar_concrete', () => {
    const definitions = {
      test: '123 456abc|789xyz 0',
    };
    const store = parseGrids(definitions);

    const grid = store.get('test')!;
    expect(grid.rows).toBe(2);
    expect(grid.cols).toBe(2);

    // First row: "123", "456abc"
    expect(grid.cells[0][0]).toBeInstanceOf(Concrete);
    expect((grid.cells[0][0] as Concrete).id).toBe('123');
    expect(grid.cells[0][1]).toBeInstanceOf(Concrete);
    expect((grid.cells[0][1] as Concrete).id).toBe('456abc');

    // Second row: "789xyz", "0"
    expect(grid.cells[1][0]).toBeInstanceOf(Concrete);
    expect((grid.cells[1][0] as Concrete).id).toBe('789xyz');
    expect(grid.cells[1][1]).toBeInstanceOf(Concrete);
    expect((grid.cells[1][1] as Concrete).id).toBe('0');
  });

  it('test_parse_multichar_refs', () => {
    const definitions = {
      Main: '100 Inner|200 Grid2',
      Inner: 'x',
      Grid2: 'y',
    };
    const store = parseGrids(definitions);

    const grid = store.get('Main')!;
    expect(grid.rows).toBe(2);
    expect(grid.cols).toBe(2);

    // First row: Concrete("100"), Ref("Inner")
    expect(grid.cells[0][0]).toBeInstanceOf(Concrete);
    expect((grid.cells[0][0] as Concrete).id).toBe('100');
    expect(grid.cells[0][1]).toBeInstanceOf(Ref);
    expect((grid.cells[0][1] as Ref).gridId).toBe('Inner');

    // Second row: Concrete("200"), Ref("Grid2")
    expect(grid.cells[1][0]).toBeInstanceOf(Concrete);
    expect((grid.cells[1][0] as Concrete).id).toBe('200');
    expect(grid.cells[1][1]).toBeInstanceOf(Ref);
    expect((grid.cells[1][1] as Ref).gridId).toBe('Grid2');
  });

  it('test_parse_multichar_explicit_primary_refs', () => {
    const definitions = {
      test: '*MainGrid ~OtherGrid',
      MainGrid: '1',
      OtherGrid: '2',
    };
    const store = parseGrids(definitions);

    const grid = store.get('test')!;
    // First cell: *MainGrid -> Ref("MainGrid", isPrimary=true)
    expect(grid.cells[0][0]).toBeInstanceOf(Ref);
    expect((grid.cells[0][0] as Ref).gridId).toBe('MainGrid');
    expect((grid.cells[0][0] as Ref).isPrimary).toBe(true);

    // Second cell: ~OtherGrid -> Ref("OtherGrid", isPrimary=false)
    expect(grid.cells[0][1]).toBeInstanceOf(Ref);
    expect((grid.cells[0][1] as Ref).gridId).toBe('OtherGrid');
    expect((grid.cells[0][1] as Ref).isPrimary).toBe(false);
  });

  it('test_parse_mixed_multichar_content', () => {
    const definitions = {
      MainGrid: '1item Portal 2item|100 200 Portal',
      Portal: '9x 8y',
    };
    const store = parseGrids(definitions);

    const main = store.get('MainGrid')!;
    expect(main.rows).toBe(2);
    expect(main.cols).toBe(3);

    // First row: Concrete("1item"), Ref("Portal"), Concrete("2item")
    expect(main.cells[0][0]).toBeInstanceOf(Concrete);
    expect((main.cells[0][0] as Concrete).id).toBe('1item');
    expect(main.cells[0][1]).toBeInstanceOf(Ref);
    expect((main.cells[0][1] as Ref).gridId).toBe('Portal');
    expect(main.cells[0][2]).toBeInstanceOf(Concrete);
    expect((main.cells[0][2] as Concrete).id).toBe('2item');

    // Second row: Concrete("100"), Concrete("200"), Ref("Portal")
    expect(main.cells[1][0]).toBeInstanceOf(Concrete);
    expect((main.cells[1][0] as Concrete).id).toBe('100');
    expect(main.cells[1][1]).toBeInstanceOf(Concrete);
    expect((main.cells[1][1] as Concrete).id).toBe('200');
    expect(main.cells[1][2]).toBeInstanceOf(Ref);
    expect((main.cells[1][2] as Ref).gridId).toBe('Portal');

    // Verify Portal grid
    const portal = store.get('Portal')!;
    expect(portal.cells[0][0]).toBeInstanceOf(Concrete);
    expect((portal.cells[0][0] as Concrete).id).toBe('9x');
    expect(portal.cells[0][1]).toBeInstanceOf(Concrete);
    expect((portal.cells[0][1] as Concrete).id).toBe('8y');
  });
});

// =============================================================================
// Test Analysis Phase
// =============================================================================

describe('TestAnalyze', () => {
  it('test_analyze_simple_grid', () => {
    const store: GridStore = new Map([
      [
        'simple',
        new Grid('simple', [
          [new Concrete('a'), new Concrete('b')],
          [new Concrete('c'), new Concrete('d')],
        ]),
      ],
    ]);
    const result = analyze(store, 'simple', new Fraction(1), new Fraction(1));
    expect(result).toBeInstanceOf(NestedNode);
    expect((result as NestedNode).gridId).toBe('simple');
    expect((result as NestedNode).children.length).toBe(2);
    expect((result as NestedNode).children[0].length).toBe(2);
  });

  it('test_analyze_with_empty_cells', () => {
    const store: GridStore = new Map([
      [
        'test',
        new Grid('test', [
          [new Empty(), new Concrete('a')],
          [new Concrete('b'), new Empty()],
        ]),
      ],
    ]);
    const result = analyze(store, 'test', new Fraction(1), new Fraction(1));
    expect(result).toBeInstanceOf(NestedNode);
    const children = (result as NestedNode).children;
    expect(children[0][0]).toBeInstanceOf(EmptyNode);
    expect(children[0][1]).toBeInstanceOf(ConcreteNode);
    expect(children[1][0]).toBeInstanceOf(ConcreteNode);
    expect(children[1][1]).toBeInstanceOf(EmptyNode);
  });

  it('test_analyze_with_reference', () => {
    const store: GridStore = new Map([
      ['inner', new Grid('inner', [[new Concrete('x')]])],
      ['outer', new Grid('outer', [[new Ref('inner')]])],
    ]);
    const result = analyze(store, 'outer', new Fraction(1), new Fraction(1));
    expect(result).toBeInstanceOf(NestedNode);
    expect((result as NestedNode).gridId).toBe('outer');
    // The referenced grid should be wrapped in RefNode
    const refNode = (result as NestedNode).children[0][0];
    expect(refNode).toBeInstanceOf(RefNode);
    expect((refNode as RefNode).gridId).toBe('outer');
    expect((refNode as RefNode).refTarget).toBe('inner');
    expect((refNode as RefNode).isPrimary).toBe(true);
    // The content should be the nested grid
    expect((refNode as RefNode).content).toBeInstanceOf(NestedNode);
    expect(((refNode as RefNode).content as NestedNode).gridId).toBe('inner');
  });

  it('test_analyze_with_threshold_cutoff', () => {
    const store: GridStore = new Map([['test', new Grid('test', [[new Concrete('a')]])]]);
    // Set threshold higher than the cell dimensions
    const result = analyze(
      store,
      'test',
      new Fraction(1, 100),
      new Fraction(1, 100),
      new Fraction(1, 10)
    );
    expect(result).toBeInstanceOf(CutoffNode);
  });

  it('test_analyze_self_referencing_grid', () => {
    const store: GridStore = new Map([
      ['recursive', new Grid('recursive', [[new Concrete('a'), new Ref('recursive')]])],
    ]);
    // Should terminate due to threshold
    const result = analyze(store, 'recursive', new Fraction(1), new Fraction(1));
    expect(result).toBeInstanceOf(NestedNode);
    // The reference should eventually cutoff
    const refCell = (result as NestedNode).children[0][1];
    // Should be wrapped in RefNode
    expect(refCell).toBeInstanceOf(RefNode);
    // The content may be nested multiple times before cutoff
    expect((refCell as RefNode).content).toBeInstanceOf(NestedNode);
  });
});

// =============================================================================
// Test Traversal
// =============================================================================

describe('TestFindPrimaryRef', () => {
  it('test_find_primary_ref_simple', () => {
    const store: GridStore = new Map([
      ['inner', new Grid('inner', [[new Concrete('x')]])],
      ['outer', new Grid('outer', [[new Ref('inner')]])],
    ]);
    const result = findPrimaryRef(store, 'inner');
    expect(result).not.toBe(null);
    expect(result).toEqual(['outer', 0, 0]);
  });

  it('test_find_primary_ref_none', () => {
    const store: GridStore = new Map([['root', new Grid('root', [[new Concrete('x')]])]]);
    const result = findPrimaryRef(store, 'root');
    expect(result).toBe(null);
  });

  it('test_find_primary_ref_first_occurrence', () => {
    const store: GridStore = new Map([
      ['inner', new Grid('inner', [[new Concrete('x')]])],
      ['outer', new Grid('outer', [[new Ref('inner'), new Ref('inner')]])],
    ]);
    const result = findPrimaryRef(store, 'inner');
    expect(result).toEqual(['outer', 0, 0]); // First ref should be primary
  });

  it('test_find_primary_ref_explicit_primary', () => {
    const store: GridStore = new Map([
      ['inner', new Grid('inner', [[new Concrete('x')]])],
      [
        'outer',
        new Grid('outer', [[new Ref('inner', false), new Ref('inner', true)]]),
      ],
    ]);
    const result = findPrimaryRef(store, 'inner');
    expect(result).toEqual(['outer', 0, 1]); // Second ref is explicitly primary
  });

  it('test_find_primary_ref_explicit_overrides_order', () => {
    const store: GridStore = new Map([
      ['inner', new Grid('inner', [[new Concrete('1')]])],
      ['outer', new Grid('outer', [[new Ref('inner', false), new Ref('inner', true)]])],
    ]);
    const result = findPrimaryRef(store, 'inner');
    expect(result).toEqual(['outer', 0, 1]); // Explicit primary wins
  });
});

describe('TestTraverse', () => {
  it('test_traverse_simple_east', () => {
    const store: GridStore = new Map([
      [
        'test',
        new Grid('test', [[new Concrete('a'), new Concrete('b'), new Concrete('c')]]),
      ],
    ]);
    const start = new CellPosition('test', 0, 0);

    function tryEnter(gridId: string, direction: Direction): CellPosition | null {
      return null;
    }

    const positions = Array.from(traverse(store, start, Direction.E, tryEnter));
    expect(positions.length).toBe(3);
    expect(positions[0]).toEqual(new CellPosition('test', 0, 0));
    expect(positions[1]).toEqual(new CellPosition('test', 0, 1));
    expect(positions[2]).toEqual(new CellPosition('test', 0, 2));
  });

  it('test_traverse_simple_south', () => {
    const store: GridStore = new Map([
      [
        'test',
        new Grid('test', [[new Concrete('a')], [new Concrete('b')], [new Concrete('c')]]),
      ],
    ]);
    const start = new CellPosition('test', 0, 0);

    function tryEnter(gridId: string, direction: Direction): CellPosition | null {
      return null;
    }

    const positions = Array.from(traverse(store, start, Direction.S, tryEnter));
    expect(positions.length).toBe(3);
    expect(positions[0]).toEqual(new CellPosition('test', 0, 0));
    expect(positions[1]).toEqual(new CellPosition('test', 1, 0));
    expect(positions[2]).toEqual(new CellPosition('test', 2, 0));
  });

  it('test_traverse_stops_at_edge', () => {
    const store: GridStore = new Map([
      ['test', new Grid('test', [[new Concrete('a'), new Concrete('b')]])],
    ]);
    const start = new CellPosition('test', 0, 1);

    function tryEnter(gridId: string, direction: Direction): CellPosition | null {
      return null;
    }

    const positions = Array.from(traverse(store, start, Direction.E, tryEnter));
    expect(positions.length).toBe(1); // Can't go further east
  });

  it('test_traverse_with_auto_enter', () => {
    const store: GridStore = new Map([
      ['inner', new Grid('inner', [[new Concrete('x'), new Concrete('y')]])],
      [
        'outer',
        new Grid('outer', [[new Concrete('a'), new Ref('inner'), new Concrete('b')]]),
      ],
    ]);
    const start = new CellPosition('outer', 0, 0);

    function tryEnter(gridId: string, direction: Direction): CellPosition | null {
      const grid = store.get(gridId);
      if (direction === Direction.E) {
        return new CellPosition(gridId, 0, 0);
      }
      return null;
    }

    // With autoEnter=true, should skip yielding the Ref cell
    const positions = Array.from(traverse(store, start, Direction.E, tryEnter, true));

    // Should visit: a -> (enter inner at x) -> x -> y -> (exit to b) -> b
    expect(positions.some((p) => p.equals(new CellPosition('outer', 0, 0)))).toBe(true); // a
    expect(positions.some((p) => p.equals(new CellPosition('inner', 0, 0)))).toBe(true); // x
    expect(positions.some((p) => p.equals(new CellPosition('inner', 0, 1)))).toBe(true); // y
    expect(positions.some((p) => p.equals(new CellPosition('outer', 0, 2)))).toBe(true); // b
  });

  it('test_traverse_without_auto_exit', () => {
    const store: GridStore = new Map([
      ['inner', new Grid('inner', [[new Concrete('x')]])],
      ['outer', new Grid('outer', [[new Ref('inner'), new Concrete('a')]])],
    ]);
    const start = new CellPosition('inner', 0, 0);

    function tryEnter(gridId: string, direction: Direction): CellPosition | null {
      const grid = store.get(gridId);
      return new CellPosition(gridId, 0, 0);
    }

    // Start inside and traverse east (should exit to outer)
    const positions = Array.from(
      traverse(store, start, Direction.E, tryEnter, false, false)
    );

    // Should stop at the Ref cell
    expect(positions[positions.length - 1]).toEqual(new CellPosition('outer', 0, 0));
  });

  it('test_traverse_enter_chain_simple', () => {
    const store: GridStore = new Map([
      ['level3', new Grid('level3', [[new Concrete('z')]])],
      ['level2', new Grid('level2', [[new Ref('level3')]])],
      ['level1', new Grid('level1', [[new Concrete('a'), new Ref('level2')]])],
    ]);
    const start = new CellPosition('level1', 0, 0);

    function tryEnter(gridId: string, direction: Direction): CellPosition | null {
      // Always enter at (0, 0)
      return new CellPosition(gridId, 0, 0);
    }

    const positions = Array.from(traverse(store, start, Direction.E, tryEnter, true));

    // Should visit: a -> (enter level2, skip its Ref) -> (enter level3) -> z
    // With chain following, should only yield: a, z
    expect(positions.some((p) => p.equals(new CellPosition('level1', 0, 0)))).toBe(true); // a
    expect(positions.some((p) => p.equals(new CellPosition('level3', 0, 0)))).toBe(true); // z
    // Should NOT yield intermediate Ref positions
    expect(positions.some((p) => p.equals(new CellPosition('level2', 0, 0)))).toBe(false);
  });

  it('test_traverse_exit_chain_simple', () => {
    const store: GridStore = new Map([
      ['target', new Grid('target', [[new Concrete('t')]])],
      ['inner', new Grid('inner', [[new Concrete('x')]])],
      ['outer', new Grid('outer', [[new Ref('inner'), new Ref('target')]])],
    ]);
    // Start inside inner, traverse east to exit
    const start = new CellPosition('inner', 0, 0);

    function tryEnter(gridId: string, direction: Direction): CellPosition | null {
      return new CellPosition(gridId, 0, 0);
    }

    const positions = Array.from(traverse(store, start, Direction.E, tryEnter, true, true));

    // Should: x -> exit to outer[0,0] (primary Ref) ->
    // try to exit East -> lands on outer[0,1] which is Ref("target") ->
    // chain follows through to target[0,0]
    expect(positions.some((p) => p.equals(new CellPosition('inner', 0, 0)))).toBe(true); // x
    expect(positions.some((p) => p.equals(new CellPosition('target', 0, 0)))).toBe(true); // t (final destination after exit chain)
    // Should not yield the intermediate Ref at outer[0,1]
    expect(positions.some((p) => p.equals(new CellPosition('outer', 0, 1)))).toBe(false);
  });

  it('test_traverse_enter_chain_cycle', () => {
    const store: GridStore = new Map([
      ['a', new Grid('a', [[new Ref('b')]])],
      ['b', new Grid('b', [[new Ref('a')]])],
      ['main', new Grid('main', [[new Concrete('x'), new Ref('a')]])],
    ]);
    const start = new CellPosition('main', 0, 0);

    function tryEnter(gridId: string, direction: Direction): CellPosition | null {
      // Always enter at (0, 0)
      return new CellPosition(gridId, 0, 0);
    }

    const positions = Array.from(traverse(store, start, Direction.E, tryEnter, true));

    // Should visit x, then try to enter a->b->a (cycle)
    // Traversal should terminate when cycle detected
    expect(positions.some((p) => p.equals(new CellPosition('main', 0, 0)))).toBe(true); // x
    // Should not continue after detecting cycle
    expect(positions.length).toBe(1);
  });

  it('test_traverse_exit_chain_cycle', () => {
    const store: GridStore = new Map([
      // Create a situation where exiting leads to a cycle
      ['inner', new Grid('inner', [[new Concrete('x')]])],
      ['loop1', new Grid('loop1', [[new Ref('loop2')]])],
      ['loop2', new Grid('loop2', [[new Ref('loop1')]])],
      ['main', new Grid('main', [[new Ref('inner'), new Ref('loop1')]])],
    ]);
    // Start in loop1 and try to exit east
    const start = new CellPosition('loop1', 0, 0);

    function tryEnter(gridId: string, direction: Direction): CellPosition | null {
      return new CellPosition(gridId, 0, 0);
    }

    const positions = Array.from(traverse(store, start, Direction.E, tryEnter, true, true));

    // Should start at loop1[0,0], try to exit, detect cycle
    // The traversal should terminate gracefully
    expect(positions.some((p) => p.equals(new CellPosition('loop1', 0, 0)))).toBe(true);
    // Verify it terminates (doesn't hang)
    expect(positions.length).toBeLessThan(100); // Sanity check
  });

  it('test_traverse_enter_chain_denied', () => {
    const store: GridStore = new Map([
      ['blocked', new Grid('blocked', [[new Concrete('b')]])],
      ['level2', new Grid('level2', [[new Ref('blocked')]])],
      ['level1', new Grid('level1', [[new Concrete('a'), new Ref('level2')]])],
    ]);
    const start = new CellPosition('level1', 0, 0);

    function tryEnter(gridId: string, direction: Direction): CellPosition | null {
      // Allow entering level2, but deny entry to "blocked"
      if (gridId === 'level2') {
        return new CellPosition(gridId, 0, 0);
      } else if (gridId === 'blocked') {
        return null; // Deny entry
      }
      return new CellPosition(gridId, 0, 0);
    }

    const positions = Array.from(traverse(store, start, Direction.E, tryEnter, true));

    // Should visit a, then try to enter level2->blocked chain
    // When blocked entry is denied, traversal should terminate
    expect(positions.some((p) => p.equals(new CellPosition('level1', 0, 0)))).toBe(true); // a
    // Should not reach blocked
    expect(positions.some((p) => p.equals(new CellPosition('blocked', 0, 0)))).toBe(false);
    // Should terminate after denied entry
    expect(positions.length).toBe(1);
  });

  it('test_traverse_mixed_enter_exit_chains', () => {
    const store: GridStore = new Map([
      ['deep', new Grid('deep', [[new Concrete('d')]])],
      ['mid', new Grid('mid', [[new Ref('deep')]])],
      ['shallow', new Grid('shallow', [[new Concrete('s'), new Ref('mid')]])],
      ['outer', new Grid('outer', [[new Ref('shallow'), new Ref('deep')]])],
    ]);
    // Start in shallow, move east to trigger enter chain,
    // then continue to trigger exit chain
    const start = new CellPosition('shallow', 0, 0);

    function tryEnter(gridId: string, direction: Direction): CellPosition | null {
      return new CellPosition(gridId, 0, 0);
    }

    const positions = Array.from(traverse(store, start, Direction.E, tryEnter, true, true));

    // Should: s -> (enter mid->deep chain) -> d -> (exit back through chain)
    expect(positions.some((p) => p.equals(new CellPosition('shallow', 0, 0)))).toBe(true); // s
    expect(positions.some((p) => p.equals(new CellPosition('deep', 0, 0)))).toBe(true); // d (after enter chain)
    // Should follow chains without yielding intermediate Refs
    expect(positions.some((p) => p.equals(new CellPosition('mid', 0, 0)))).toBe(false);
  });

  it('test_traverse_enter_chain_fast_path', () => {
    const store: GridStore = new Map([
      ['inner', new Grid('inner', [[new Concrete('x'), new Concrete('y')]])],
      ['outer', new Grid('outer', [[new Concrete('a'), new Ref('inner')]])],
    ]);
    const start = new CellPosition('outer', 0, 0);

    function tryEnter(gridId: string, direction: Direction): CellPosition | null {
      return new CellPosition(gridId, 0, 0);
    }

    const positions = Array.from(traverse(store, start, Direction.E, tryEnter, true));

    // Should: a -> (enter inner at x, which is not a Ref) -> x -> y
    expect(positions.some((p) => p.equals(new CellPosition('outer', 0, 0)))).toBe(true); // a
    expect(positions.some((p) => p.equals(new CellPosition('inner', 0, 0)))).toBe(true); // x (immediate non-Ref)
    expect(positions.some((p) => p.equals(new CellPosition('inner', 0, 1)))).toBe(true); // y
    // Should work efficiently without unnecessary chain checks
    expect(positions.length).toBe(3);
  });
});

// =============================================================================
// Test Push
// =============================================================================

describe('TestPush', () => {
  it('test_push_simple_to_empty', () => {
    const store: GridStore = new Map([
      ['main', new Grid('main', [[new Concrete('A'), new Concrete('B'), new Empty()]])],
    ]);

    function allowAllEntry(gridId: string, direction: Direction): CellPosition | null {
      const grid = store.get(gridId)!;
      if (direction === Direction.E) {
        return new CellPosition(gridId, 0, 0);
      } else if (direction === Direction.W) {
        return new CellPosition(gridId, 0, grid.cols - 1);
      } else if (direction === Direction.S) {
        return new CellPosition(gridId, 0, 0);
      } else {
        // Direction.N
        return new CellPosition(gridId, grid.rows - 1, 0);
      }
    }

    const start = new CellPosition('main', 0, 0);
    const result = pushSimple(store, start, Direction.E, allowAllEntry);

    expect(result).not.toBe(null);
    // After push: [A, B, Empty] -> [Empty, A, B]
    expect(result!.get('main')!.cells[0][0]).toBeInstanceOf(Empty);
    expect(result!.get('main')!.cells[0][1]).toEqual(new Concrete('A'));
    expect(result!.get('main')!.cells[0][2]).toEqual(new Concrete('B'));
  });

  it('test_push_single_cell_at_empty', () => {
    const store: GridStore = new Map([
      ['main', new Grid('main', [[new Empty(), new Concrete('A')]])],
    ]);

    function allowAllEntry(gridId: string, direction: Direction): CellPosition | null {
      return null;
    }

    const start = new CellPosition('main', 0, 0);
    const result = pushSimple(store, start, Direction.E, allowAllEntry);

    // Path: [Empty, A], push ends at A (not Empty) -> should fail
    expect(result).toBe(null);
  });

  it('test_push_immutability', () => {
    const store: GridStore = new Map([
      ['main', new Grid('main', [[new Concrete('A'), new Concrete('B'), new Empty()]])],
    ]);

    function allowAllEntry(gridId: string, direction: Direction): CellPosition | null {
      const grid = store.get(gridId);
      if (direction === Direction.E) {
        return new CellPosition(gridId, 0, 0);
      }
      return null;
    }

    const start = new CellPosition('main', 0, 0);
    const result = pushSimple(store, start, Direction.E, allowAllEntry);

    expect(result).not.toBe(null);
    // Original store should be unchanged
    expect(store.get('main')!.cells[0][0]).toEqual(new Concrete('A'));
    expect(store.get('main')!.cells[0][1]).toEqual(new Concrete('B'));
    expect(store.get('main')!.cells[0][2]).toBeInstanceOf(Empty);
  });

  it('test_push_fails_edge_no_empty', () => {
    const store: GridStore = new Map([
      [
        'main',
        new Grid('main', [[new Concrete('A'), new Concrete('B'), new Concrete('C')]]),
      ],
    ]);

    function allowAllEntry(gridId: string, direction: Direction): CellPosition | null {
      return null;
    }

    const start = new CellPosition('main', 0, 0);
    const result = pushSimple(store, start, Direction.E, allowAllEntry);

    // Path: [A, B, C], hits edge at non-Empty -> should fail
    expect(result).toBe(null);
  });

  it('test_push_through_portal', () => {
    const store: GridStore = new Map([
      ['main', new Grid('main', [[new Concrete('A'), new Ref('inner'), new Empty()]])],
      ['inner', new Grid('inner', [[new Concrete('X'), new Concrete('Y')]])],
    ]);

    function allowEntryFromWest(
      gridId: string,
      direction: Direction
    ): CellPosition | null {
      if (gridId === 'inner' && direction === Direction.E) {
        const grid = store.get('inner')!;
        return new CellPosition('inner', Math.floor(grid.rows / 2), 0); // Enter from west
      }
      return null;
    }

    const start = new CellPosition('main', 0, 0);
    const result = pushSimple(store, start, Direction.E, allowEntryFromWest);

    expect(result).not.toBe(null);
    // After push: A -> X -> Y -> Empty
    // Rotation: [A, X, Y, Empty] -> [Empty, A, X, Y]
    expect(result!.get('main')!.cells[0][0]).toBeInstanceOf(Empty);
    expect(result!.get('main')!.cells[0][1]).toEqual(new Ref('inner')); // Ref not pushed
    expect(result!.get('main')!.cells[0][2]).toBeInstanceOf(Concrete);
    expect(result!.get('main')!.cells[0][2]).toEqual(new Concrete('Y'));

    // Inner grid updated
    expect(result!.get('inner')!.cells[0][0]).toEqual(new Concrete('A'));
    expect(result!.get('inner')!.cells[0][1]).toEqual(new Concrete('X'));
  });

  it('test_push_blocked_ref', () => {
    const store: GridStore = new Map([
      ['main', new Grid('main', [[new Concrete('A'), new Ref('locked'), new Empty()]])],
      ['locked', new Grid('locked', [[new Concrete('SECRET')]])],
    ]);

    function denyEntry(gridId: string, direction: Direction): CellPosition | null {
      if (gridId === 'locked') {
        return null; // Deny entry to "locked"
      }
      return new CellPosition(gridId, 0, 0);
    }

    const start = new CellPosition('main', 0, 0);
    const result = pushSimple(store, start, Direction.E, denyEntry);

    expect(result).not.toBe(null);
    // Path: [A, Ref(locked), Empty]
    // Ref acts as solid object, gets pushed
    // Rotation: [A, Ref, Empty] -> [Empty, A, Ref]
    expect(result!.get('main')!.cells[0][0]).toBeInstanceOf(Empty);
    expect(result!.get('main')!.cells[0][1]).toEqual(new Concrete('A'));
    expect(result!.get('main')!.cells[0][2]).toEqual(new Ref('locked'));

    // Locked grid unchanged
    expect(result!.get('locked')!.cells[0][0]).toEqual(new Concrete('SECRET'));
  });

  it('test_push_affects_multiple_grids', () => {
    const store: GridStore = new Map([
      ['main', new Grid('main', [[new Concrete('A'), new Ref('inner'), new Empty()]])],
      ['inner', new Grid('inner', [[new Concrete('X'), new Concrete('Y')]])],
    ]);

    function allowEntry(gridId: string, direction: Direction): CellPosition | null {
      if (gridId === 'inner' && direction === Direction.E) {
        const grid = store.get('inner')!;
        return new CellPosition('inner', Math.floor(grid.rows / 2), 0);
      }
      return null;
    }

    const start = new CellPosition('main', 0, 0);
    const result = pushSimple(store, start, Direction.E, allowEntry);

    expect(result).not.toBe(null);
    // Both grids should be updated
    expect(result!.has('main')).toBe(true);
    expect(result!.has('inner')).toBe(true);

    // Verify changes
    expect(result!.get('main')!.cells[0][0]).toBeInstanceOf(Empty);
    expect(result!.get('inner')!.cells[0][0]).toEqual(new Concrete('A'));
  });

  it('test_push_stops_at_empty', () => {
    const store: GridStore = new Map([
      [
        'main',
        new Grid('main', [
          [
            new Concrete('A'),
            new Concrete('B'),
            new Empty(),
            new Concrete('C'),
            new Concrete('D'),
          ],
        ]),
      ],
    ]);

    function allowAllEntry(gridId: string, direction: Direction): CellPosition | null {
      return null;
    }

    const start = new CellPosition('main', 0, 0);
    const result = pushSimple(store, start, Direction.E, allowAllEntry);

    expect(result).not.toBe(null);
    // After push: [A, B, Empty, C, D] -> [Empty, A, B, C, D]
    // Only the first 3 cells should be affected
    expect(result!.get('main')!.cells[0][0]).toBeInstanceOf(Empty);
    expect(result!.get('main')!.cells[0][1]).toEqual(new Concrete('A'));
    expect(result!.get('main')!.cells[0][2]).toEqual(new Concrete('B'));
    // C and D should remain unchanged
    expect(result!.get('main')!.cells[0][3]).toEqual(new Concrete('C'));
    expect(result!.get('main')!.cells[0][4]).toEqual(new Concrete('D'));
  });

  it('test_push_stops_at_empty_through_portal', () => {
    const store: GridStore = new Map([
      ['main', new Grid('main', [[new Concrete('A'), new Ref('inner'), new Concrete('C')]])],
      ['inner', new Grid('inner', [[new Concrete('X'), new Empty()]])],
    ]);

    function allowEntry(gridId: string, direction: Direction): CellPosition | null {
      if (gridId === 'inner' && direction === Direction.E) {
        const grid = store.get('inner')!;
        return new CellPosition('inner', Math.floor(grid.rows / 2), 0);
      }
      return null;
    }

    const start = new CellPosition('main', 0, 0);
    const result = pushSimple(store, start, Direction.E, allowEntry);

    expect(result).not.toBe(null);
    // Path should be: [A, X, Empty]
    // After rotation: [Empty, A, X]
    // Main[0,0] should be Empty, Main[0,2] should still be C (unchanged)
    expect(result!.get('main')!.cells[0][0]).toBeInstanceOf(Empty);
    expect(result!.get('main')!.cells[0][2]).toEqual(new Concrete('C')); // C unchanged
    // Inner should have [A, X]
    expect(result!.get('inner')!.cells[0][0]).toEqual(new Concrete('A'));
    expect(result!.get('inner')!.cells[0][1]).toEqual(new Concrete('X'));
  });
});

// =============================================================================
// Test Push with Backtracking
// =============================================================================

describe('TestPushBacktracking', () => {
  it('test_backtrack_on_stop_inside_ref', () => {
    const store: GridStore = new Map([
      ['main', new Grid('main', [[new Concrete('A'), new Ref('inner'), new Empty()]])],
      ['inner', new Grid('inner', [[new Concrete('X'), new Concrete('STOP')]])],
    ]);

    function tagStop(cell: Cell): Set<string> {
      if (cell._tag === 'Concrete' && cell.id === 'STOP') {
        return new Set(['stop']);
      }
      return new Set();
    }

    function allowEntry(gridId: string, direction: Direction): CellPosition | null {
      if (gridId === 'inner' && direction === Direction.E) {
        const grid = store.get('inner')!;
        return new CellPosition('inner', Math.floor(grid.rows / 2), 0);
      }
      return null;
    }

    const start = new CellPosition('main', 0, 0);

    // Simple version should fail
    const resultSimple = pushSimple(store, start, Direction.E, allowEntry, tagStop);
    expect(resultSimple).toBe(null);

    // Backtracking version should succeed
    const result = push(store, start, Direction.E, allowEntry, tagStop);
    expect(result).not.toBe(null);

    // Result: [Empty, A, Ref(inner)]
    expect(result!.get('main')!.cells[0][0]).toBeInstanceOf(Empty);
    expect(result!.get('main')!.cells[0][1]).toEqual(new Concrete('A'));
    expect(result!.get('main')!.cells[0][2]).toEqual(new Ref('inner'));

    // Inner grid should be unchanged (Ref treated as solid, not entered)
    expect(result!.get('inner')!.cells[0][0]).toEqual(new Concrete('X'));
    expect(result!.get('inner')!.cells[0][1]).toEqual(new Concrete('STOP'));
  });

  it('test_no_backtrack_when_simple_succeeds', () => {
    const store: GridStore = new Map([
      ['main', new Grid('main', [[new Concrete('A'), new Ref('inner'), new Empty()]])],
      ['inner', new Grid('inner', [[new Concrete('X'), new Concrete('Y')]])],
    ]);

    function allowEntry(gridId: string, direction: Direction): CellPosition | null {
      if (gridId === 'inner' && direction === Direction.E) {
        const grid = store.get('inner')!;
        return new CellPosition('inner', Math.floor(grid.rows / 2), 0);
      }
      return null;
    }

    const start = new CellPosition('main', 0, 0);

    // Both versions should succeed with same result
    const resultSimple = pushSimple(store, start, Direction.E, allowEntry);
    const resultBacktrack = push(store, start, Direction.E, allowEntry);

    expect(resultSimple).not.toBe(null);
    expect(resultBacktrack).not.toBe(null);

    // Results should be identical
    expect(resultSimple!.get('main')!.cells).toEqual(resultBacktrack!.get('main')!.cells);
    expect(resultSimple!.get('inner')!.cells).toEqual(resultBacktrack!.get('inner')!.cells);
  });

  it('test_backtrack_multiple_levels', () => {
    const store: GridStore = new Map([
      ['main', new Grid('main', [[new Concrete('A'), new Ref('B'), new Empty()]])],
      ['B', new Grid('B', [[new Concrete('X'), new Concrete('STOP')]])],
    ]);

    function tagStop(cell: Cell): Set<string> {
      if (cell._tag === 'Concrete' && cell.id === 'STOP') {
        return new Set(['stop']);
      }
      return new Set();
    }

    function allowEntry(gridId: string, direction: Direction): CellPosition | null {
      if (gridId === 'B' && direction === Direction.E) {
        const grid = store.get('B')!;
        return new CellPosition('B', Math.floor(grid.rows / 2), 0); // Enter at X
      }
      return null;
    }

    const start = new CellPosition('main', 0, 0);

    // Simple version should fail (enters B, hits STOP after X)
    const resultSimple = pushSimple(store, start, Direction.E, allowEntry, tagStop);
    expect(resultSimple).toBe(null);

    // Backtracking version should succeed by treating Ref1 as solid
    const result = push(store, start, Direction.E, allowEntry, tagStop);
    expect(result).not.toBe(null);

    // Result: [Empty, A, Ref(B)]
    expect(result!.get('main')!.cells[0][0]).toBeInstanceOf(Empty);
    expect(result!.get('main')!.cells[0][1]).toEqual(new Concrete('A'));
    expect(result!.get('main')!.cells[0][2]).toEqual(new Ref('B'));
  });

  it('test_backtrack_on_entry_denied_in_chain', () => {
    const store: GridStore = new Map([
      ['main', new Grid('main', [[new Concrete('A'), new Ref('B'), new Empty()]])],
      ['B', new Grid('B', [[new Ref('C')]])],
      ['C', new Grid('C', [[new Concrete('X')]])],
    ]);

    function allowEntry(gridId: string, direction: Direction): CellPosition | null {
      if (gridId === 'B' && direction === Direction.E) {
        const grid = store.get('B')!;
        return new CellPosition('B', Math.floor(grid.rows / 2), 0);
      }
      // Deny entry to C
      return null;
    }

    const start = new CellPosition('main', 0, 0);

    // Simple version should fail
    const resultSimple = pushSimple(store, start, Direction.E, allowEntry);
    expect(resultSimple).toBe(null);

    // Backtracking version should succeed
    const result = push(store, start, Direction.E, allowEntry);
    expect(result).not.toBe(null);

    // Result: [Empty, A, Ref(B)]
    expect(result!.get('main')!.cells[0][0]).toBeInstanceOf(Empty);
    expect(result!.get('main')!.cells[0][1]).toEqual(new Concrete('A'));
    expect(result!.get('main')!.cells[0][2]).toEqual(new Ref('B'));
  });
});

// =============================================================================
// Test Termination Reasons
// =============================================================================

describe('TestTerminationReasons', () => {
  it('test_termination_edge_reached', () => {
    const store: GridStore = new Map([
      ['main', new Grid('main', [[new Concrete('a'), new Concrete('b')]])],
    ]);
    const start = new CellPosition('main', 0, 0);

    function tryEnter(gridId: string, direction: Direction): CellPosition | null {
      return new CellPosition(gridId, 0, 0);
    }

    const result = traverse(store, start, Direction.E, tryEnter);
    const positions = Array.from(result);

    // Should traverse: a -> b -> edge
    expect(positions.length).toBe(2);
    expect(result.terminationReason).toBe(TerminationReason.EDGE_REACHED);
  });

  it('test_termination_cycle_detected_enter', () => {
    const store: GridStore = new Map([
      ['a', new Grid('a', [[new Ref('b')]])],
      ['b', new Grid('b', [[new Ref('a')]])],
      ['main', new Grid('main', [[new Concrete('x'), new Ref('a')]])],
    ]);
    const start = new CellPosition('main', 0, 0);

    function tryEnter(gridId: string, direction: Direction): CellPosition | null {
      return new CellPosition(gridId, 0, 0);
    }

    const result = traverse(store, start, Direction.E, tryEnter, true);
    const positions = Array.from(result);

    // Should detect cycle when trying to enter a->b->a
    expect(positions.length).toBe(1); // Only x
    expect(result.terminationReason).toBe(TerminationReason.ENTRY_CYCLE_DETECTED);
  });

  it('test_termination_cycle_detected_exit', () => {
    const store: GridStore = new Map([
      ['inner', new Grid('inner', [[new Concrete('x')]])],
      ['loop1', new Grid('loop1', [[new Ref('loop2')]])],
      ['loop2', new Grid('loop2', [[new Ref('loop1')]])],
      ['main', new Grid('main', [[new Ref('inner'), new Ref('loop1')]])],
    ]);
    const start = new CellPosition('loop1', 0, 0);

    function tryEnter(gridId: string, direction: Direction): CellPosition | null {
      return new CellPosition(gridId, 0, 0);
    }

    const result = traverse(store, start, Direction.E, tryEnter, true, true);
    Array.from(result);

    // Should detect cycle when trying to exit
    expect(result.terminationReason).toBe(TerminationReason.EXIT_CYCLE_DETECTED);
  });

  it('test_termination_entry_denied_auto_enter', () => {
    const store: GridStore = new Map([
      ['inner', new Grid('inner', [[new Concrete('x')]])],
      ['main', new Grid('main', [[new Concrete('a'), new Ref('inner')]])],
    ]);
    const start = new CellPosition('main', 0, 0);

    function tryEnter(gridId: string, direction: Direction): CellPosition | null {
      return null; // Deny entry
    }

    const result = traverse(store, start, Direction.E, tryEnter, true);
    const positions = Array.from(result);

    // Should stop before the Ref when entry is denied
    expect(positions.length).toBe(1); // Only a
    expect(result.terminationReason).toBe(TerminationReason.ENTRY_DENIED);
  });

  it('test_termination_entry_denied_manual_enter', () => {
    const store: GridStore = new Map([
      ['inner', new Grid('inner', [[new Concrete('x')]])],
      ['main', new Grid('main', [[new Concrete('a'), new Ref('inner')]])],
    ]);
    const start = new CellPosition('main', 0, 0);

    function tryEnter(gridId: string, direction: Direction): CellPosition | null {
      return null; // Deny entry
    }

    const result = traverse(store, start, Direction.E, tryEnter, false);
    const positions = Array.from(result);

    // Should yield a, then Ref, then stop when entry is denied
    expect(positions.length).toBe(2); // a and Ref
    expect(result.terminationReason).toBe(TerminationReason.ENTRY_DENIED);
  });

  it('test_termination_max_depth_reached', () => {
    const store: GridStore = new Map([
      ['a', new Grid('a', [[new Ref('b')]])],
      ['b', new Grid('b', [[new Concrete('x')]])],
      ['main', new Grid('main', [[new Ref('a')]])],
    ]);
    const start = new CellPosition('main', 0, 0);

    function tryEnter(gridId: string, direction: Direction): CellPosition | null {
      return new CellPosition(gridId, 0, 0);
    }

    // Set a very low max_depth to trigger the limit
    const result = traverse(store, start, Direction.E, tryEnter, true, true, 0);
    const positions = Array.from(result);

    // Should stop immediately due to max_depth=0
    expect(positions.length).toBe(1); // Only start position
    expect(result.terminationReason).toBe(TerminationReason.MAX_DEPTH_REACHED);
  });
});

// =============================================================================
// Test Tagging
// =============================================================================

describe('TestTagging', () => {
  it('test_stop_tag_terminates_traversal', () => {
    const store: GridStore = new Map([
      [
        'test',
        new Grid('test', [[new Concrete('a'), new Concrete('b'), new Concrete('c')]]),
      ],
    ]);
    const start = new CellPosition('test', 0, 0);

    function tryEnter(gridId: string, direction: Direction): CellPosition | null {
      return null;
    }

    function tagFn(cell: Cell): Set<string> {
      // Tag 'b' with 'stop'
      if (cell._tag === 'Concrete' && cell.id === 'b') {
        return new Set(['stop']);
      }
      return new Set();
    }

    const result = traverse(store, start, Direction.E, tryEnter, false, true, 1000, tagFn);
    const positions = Array.from(result);

    // Should visit only 'a', stop before 'b'
    expect(positions.length).toBe(1);
    expect(positions[0]).toEqual(new CellPosition('test', 0, 0)); // a
    expect(result.terminationReason).toBe(TerminationReason.STOP_TAG);
  });

  it('test_no_tag_fn_continues_normally', () => {
    const store: GridStore = new Map([
      [
        'test',
        new Grid('test', [[new Concrete('a'), new Concrete('b'), new Concrete('c')]]),
      ],
    ]);
    const start = new CellPosition('test', 0, 0);

    function tryEnter(gridId: string, direction: Direction): CellPosition | null {
      return null;
    }

    const result = traverse(store, start, Direction.E, tryEnter);
    const positions = Array.from(result);

    // Should visit all cells
    expect(positions.length).toBe(3);
    expect(result.terminationReason).toBe(TerminationReason.EDGE_REACHED);
  });

  it('test_empty_tags_continues_traversal', () => {
    const store: GridStore = new Map([
      [
        'test',
        new Grid('test', [[new Concrete('a'), new Concrete('b'), new Concrete('c')]]),
      ],
    ]);
    const start = new CellPosition('test', 0, 0);

    function tryEnter(gridId: string, direction: Direction): CellPosition | null {
      return null;
    }

    function tagFn(cell: Cell): Set<string> {
      // Return empty set for all cells
      return new Set();
    }

    const result = traverse(store, start, Direction.E, tryEnter, false, true, 1000, tagFn);
    const positions = Array.from(result);

    // Should visit all cells
    expect(positions.length).toBe(3);
    expect(result.terminationReason).toBe(TerminationReason.EDGE_REACHED);
  });

  it('test_non_stop_tags_ignored', () => {
    const store: GridStore = new Map([
      [
        'test',
        new Grid('test', [[new Concrete('a'), new Concrete('b'), new Concrete('c')]]),
      ],
    ]);
    const start = new CellPosition('test', 0, 0);

    function tryEnter(gridId: string, direction: Direction): CellPosition | null {
      return null;
    }

    function tagFn(cell: Cell): Set<string> {
      // Tag 'b' with something other than 'stop'
      if (cell._tag === 'Concrete' && cell.id === 'b') {
        return new Set(['important', 'highlight']);
      }
      return new Set();
    }

    const result = traverse(store, start, Direction.E, tryEnter, false, true, 1000, tagFn);
    const positions = Array.from(result);

    // Should visit all cells (non-stop tags are ignored)
    expect(positions.length).toBe(3);
    expect(result.terminationReason).toBe(TerminationReason.EDGE_REACHED);
  });

  it('test_stop_tag_on_ref_cell', () => {
    const store: GridStore = new Map([
      ['inner', new Grid('inner', [[new Concrete('x')]])],
      ['outer', new Grid('outer', [[new Concrete('a'), new Ref('inner'), new Concrete('b')]])],
    ]);
    const start = new CellPosition('outer', 0, 0);

    function tryEnter(gridId: string, direction: Direction): CellPosition | null {
      return new CellPosition(gridId, 0, 0);
    }

    function tagFn(cell: Cell): Set<string> {
      // Tag the Ref with 'stop'
      if (cell._tag === 'Ref') {
        return new Set(['stop']);
      }
      return new Set();
    }

    const result = traverse(store, start, Direction.E, tryEnter, false, true, 1000, tagFn);
    const positions = Array.from(result);

    // Should visit only 'a', stop before Ref
    expect(positions.length).toBe(1);
    expect(positions[0]).toEqual(new CellPosition('outer', 0, 0)); // a
    expect(result.terminationReason).toBe(TerminationReason.STOP_TAG);
  });

  it('test_stop_tag_on_empty_cell', () => {
    const store: GridStore = new Map([
      ['test', new Grid('test', [[new Concrete('a'), new Empty(), new Concrete('b')]])],
    ]);
    const start = new CellPosition('test', 0, 0);

    function tryEnter(gridId: string, direction: Direction): CellPosition | null {
      return null;
    }

    function tagFn(cell: Cell): Set<string> {
      // Tag Empty cells with 'stop'
      if (cell._tag === 'Empty') {
        return new Set(['stop']);
      }
      return new Set();
    }

    const result = traverse(store, start, Direction.E, tryEnter, false, true, 1000, tagFn);
    const positions = Array.from(result);

    // Should visit only 'a', stop before Empty
    expect(positions.length).toBe(1);
    expect(positions[0]).toEqual(new CellPosition('test', 0, 0)); // a
    expect(result.terminationReason).toBe(TerminationReason.STOP_TAG);
  });

  it('test_stop_tag_with_multiple_tags', () => {
    const store: GridStore = new Map([
      [
        'test',
        new Grid('test', [[new Concrete('a'), new Concrete('b'), new Concrete('c')]]),
      ],
    ]);
    const start = new CellPosition('test', 0, 0);

    function tryEnter(gridId: string, direction: Direction): CellPosition | null {
      return null;
    }

    function tagFn(cell: Cell): Set<string> {
      // Tag 'b' with multiple tags including 'stop'
      if (cell._tag === 'Concrete' && cell.id === 'b') {
        return new Set(['important', 'stop', 'highlight']);
      }
      return new Set();
    }

    const result = traverse(store, start, Direction.E, tryEnter, false, true, 1000, tagFn);
    const positions = Array.from(result);

    // Should visit only 'a', stop before 'b'
    expect(positions.length).toBe(1);
    expect(positions[0]).toEqual(new CellPosition('test', 0, 0)); // a
    expect(result.terminationReason).toBe(TerminationReason.STOP_TAG);
  });
});

// =============================================================================
// Test Rendering Utilities
// =============================================================================

// NOTE: Rendering utility tests (collect_denominators, compute_scale, collect_grid_ids)
// are skipped because these functions are not yet implemented in the TypeScript version.
// These tests should be added when the rendering functions are ported.

// =============================================================================
// Test Rendering
// =============================================================================

// NOTE: Rendering tests are skipped because the render function is not yet
// implemented in the TypeScript version. These tests should be added when
// the rendering function is ported.

// =============================================================================
// Test Edge Cases
// =============================================================================

describe('TestEdgeCases', () => {
  it('test_single_cell_grid', () => {
    const store: GridStore = new Map([['single', new Grid('single', [[new Concrete('x')]])]]);
    const tree = analyze(store, 'single', new Fraction(1), new Fraction(1));
    expect(tree).toBeInstanceOf(NestedNode);
    // Render test skipped - function not implemented yet
  });

  it('test_grid_with_all_empty_cells', () => {
    const store: GridStore = new Map([
      [
        'empty',
        new Grid('empty', [
          [new Empty(), new Empty()],
          [new Empty(), new Empty()],
        ]),
      ],
    ]);
    const tree = analyze(store, 'empty', new Fraction(1), new Fraction(1));
    expect(tree).toBeInstanceOf(NestedNode);
    // All children should be EmptyNode
    for (const row of (tree as NestedNode).children) {
      for (const cell of row) {
        expect(cell).toBeInstanceOf(EmptyNode);
      }
    }
  });

  it('test_deeply_nested_structure', () => {
    const store: GridStore = new Map([
      ['level3', new Grid('level3', [[new Concrete('c')]])],
      ['level2', new Grid('level2', [[new Ref('level3')]])],
      ['level1', new Grid('level1', [[new Ref('level2')]])],
    ]);
    // Should handle nesting without errors
    const tree = analyze(store, 'level1', new Fraction(1), new Fraction(1));
    expect(tree).toBeInstanceOf(NestedNode);
  });

  it('test_mutual_recursion', () => {
    const store: GridStore = new Map([
      ['alpha', new Grid('alpha', [[new Concrete('a'), new Ref('beta')]])],
      ['beta', new Grid('beta', [[new Ref('alpha'), new Concrete('b')]])],
    ]);
    // Should handle mutual recursion without infinite loop
    const tree = analyze(store, 'alpha', new Fraction(1), new Fraction(1));
    expect(tree).toBeInstanceOf(NestedNode);
    // Render test skipped - function not implemented yet
  });

  it('test_large_grid', () => {
    const cells: Cell[][] = [];
    for (let i = 0; i < 5; i++) {
      const row: Cell[] = [];
      for (let j = 0; j < 5; j++) {
        row.push(new Concrete(`c${i}${j}`));
      }
      cells.push(row);
    }
    const store: GridStore = new Map([['large', new Grid('large', cells)]]);
    const tree = analyze(store, 'large', new Fraction(1), new Fraction(1));
    expect(tree).toBeInstanceOf(NestedNode);
    expect((tree as NestedNode).children.length).toBe(5);
    expect((tree as NestedNode).children[0].length).toBe(5);
  });

  it('test_traverse_all_directions', () => {
    const store: GridStore = new Map([
      [
        'test',
        new Grid('test', [
          [new Concrete('a'), new Concrete('b'), new Concrete('c')],
          [new Concrete('d'), new Concrete('e'), new Concrete('f')],
          [new Concrete('g'), new Concrete('h'), new Concrete('i')],
        ]),
      ],
    ]);
    const center = new CellPosition('test', 1, 1); // Cell "e"

    function tryEnter(gridId: string, direction: Direction): CellPosition | null {
      return null;
    }

    // Test North
    const positionsN = Array.from(traverse(store, center, Direction.N, tryEnter));
    expect(positionsN.some((p) => p.equals(new CellPosition('test', 0, 1)))).toBe(true); // Cell "b"

    // Test South
    const positionsS = Array.from(traverse(store, center, Direction.S, tryEnter));
    expect(positionsS.some((p) => p.equals(new CellPosition('test', 2, 1)))).toBe(true); // Cell "h"

    // Test East
    const positionsE = Array.from(traverse(store, center, Direction.E, tryEnter));
    expect(positionsE.some((p) => p.equals(new CellPosition('test', 1, 2)))).toBe(true); // Cell "f"

    // Test West
    const positionsW = Array.from(traverse(store, center, Direction.W, tryEnter));
    expect(positionsW.some((p) => p.equals(new CellPosition('test', 1, 0)))).toBe(true); // Cell "d"
  });
});

// =============================================================================
// Test Integration
// =============================================================================

describe('TestIntegration', () => {
  it('test_complete_workflow', () => {
    const store: GridStore = new Map([
      [
        'inner',
        new Grid('inner', [
          [new Concrete('a'), new Concrete('b')],
          [new Concrete('c'), new Concrete('d')],
        ]),
      ],
      [
        'outer',
        new Grid('outer', [
          [new Ref('inner'), new Concrete('x')],
          [new Concrete('y'), new Empty()],
        ]),
      ],
    ]);

    // Analyze
    const tree = analyze(store, 'outer', new Fraction(1), new Fraction(1));
    expect(tree).toBeInstanceOf(NestedNode);

    // Render test skipped - function not implemented yet

    // Verify structure
    expect((tree as NestedNode).gridId).toBe('outer');
    const refNode = (tree as NestedNode).children[0][0];
    expect(refNode).toBeInstanceOf(RefNode);
    expect((refNode as RefNode).gridId).toBe('outer');
    expect((refNode as RefNode).refTarget).toBe('inner');
    expect((refNode as RefNode).isPrimary).toBe(true);
    // The content should be the nested grid
    expect((refNode as RefNode).content).toBeInstanceOf(NestedNode);
    expect(((refNode as RefNode).content as NestedNode).gridId).toBe('inner');
  });

  it('test_analyze_and_traverse', () => {
    const store: GridStore = new Map([
      [
        'test',
        new Grid('test', [
          [new Concrete('a'), new Concrete('b')],
          [new Concrete('c'), new Concrete('d')],
        ]),
      ],
    ]);

    // Analyze
    const tree = analyze(store, 'test', new Fraction(1), new Fraction(1));
    expect(tree).toBeInstanceOf(NestedNode);

    // Traverse
    const start = new CellPosition('test', 0, 0);

    function tryEnter(gridId: string, direction: Direction): CellPosition | null {
      return null;
    }

    const positions = Array.from(traverse(store, start, Direction.E, tryEnter));
    expect(positions.length).toBe(2);
    expect(positions[0].gridId).toBe('test');
  });
});
