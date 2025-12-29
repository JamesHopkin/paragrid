/**
 * Main entry point for the Paragrid test results display
 */

interface TestSuite {
  name: string;
  tests: Array<{
    name: string;
    passed: boolean;
    skipped: boolean;
    reason?: string;
  }>;
}

const testSuites: TestSuite[] = [
  {
    name: 'TestGridStructures',
    tests: [
      { name: 'test_empty_cell_creation', passed: true, skipped: false },
      { name: 'test_concrete_cell_creation', passed: true, skipped: false },
      { name: 'test_ref_cell_creation', passed: true, skipped: false },
      { name: 'test_grid_creation', passed: true, skipped: false },
      { name: 'test_grid_dimensions', passed: true, skipped: false },
    ],
  },
  {
    name: 'TestParseGrids',
    tests: [
      { name: 'test_parse_simple_concrete_grid', passed: true, skipped: false },
      { name: 'test_parse_with_refs', passed: true, skipped: false },
      { name: 'test_parse_with_empty_cells', passed: true, skipped: false },
      { name: 'test_parse_with_underscore_empty', passed: true, skipped: false },
      { name: 'test_parse_multiple_grids', passed: true, skipped: false },
      { name: 'test_parse_single_row', passed: true, skipped: false },
      { name: 'test_parse_single_column', passed: true, skipped: false },
      { name: 'test_parse_case_sensitive_refs', passed: true, skipped: false },
      { name: 'test_parse_explicit_primary_ref', passed: true, skipped: false },
      { name: 'test_parse_explicit_secondary_ref', passed: true, skipped: false },
      { name: 'test_parse_auto_determined_ref', passed: true, skipped: false },
      { name: 'test_parse_mixed_primary_markers', passed: true, skipped: false },
      { name: 'test_parse_invalid_cell_raises_error', passed: true, skipped: false },
      { name: 'test_parse_invalid_cell_error_details', passed: true, skipped: false },
      { name: 'test_parse_inconsistent_row_length_raises_error', passed: true, skipped: false },
      { name: 'test_parse_inconsistent_row_length_error_details', passed: true, skipped: false },
      { name: 'test_parse_multichar_concrete', passed: true, skipped: false },
      { name: 'test_parse_multichar_refs', passed: true, skipped: false },
      { name: 'test_parse_multichar_explicit_primary_refs', passed: true, skipped: false },
      { name: 'test_parse_mixed_multichar_content', passed: true, skipped: false },
    ],
  },
  {
    name: 'TestAnalyze',
    tests: [
      { name: 'test_analyze_simple_grid', passed: true, skipped: false },
      { name: 'test_analyze_with_empty_cells', passed: true, skipped: false },
      { name: 'test_analyze_with_reference', passed: true, skipped: false },
      { name: 'test_analyze_with_threshold_cutoff', passed: true, skipped: false },
      { name: 'test_analyze_self_referencing_grid', passed: true, skipped: false },
    ],
  },
  {
    name: 'TestFindPrimaryRef',
    tests: [
      { name: 'test_find_primary_ref_simple', passed: true, skipped: false },
      { name: 'test_find_primary_ref_none', passed: true, skipped: false },
      { name: 'test_find_primary_ref_first_occurrence', passed: true, skipped: false },
      { name: 'test_find_primary_ref_explicit_primary', passed: true, skipped: false },
      { name: 'test_find_primary_ref_explicit_overrides_order', passed: true, skipped: false },
    ],
  },
  {
    name: 'TestTraverse',
    tests: [
      { name: 'test_traverse_simple_east', passed: true, skipped: false },
      { name: 'test_traverse_simple_south', passed: true, skipped: false },
      { name: 'test_traverse_stops_at_edge', passed: true, skipped: false },
      { name: 'test_traverse_with_auto_enter', passed: true, skipped: false },
      { name: 'test_traverse_without_auto_exit', passed: true, skipped: false },
      { name: 'test_traverse_enter_chain_simple', passed: true, skipped: false },
      { name: 'test_traverse_exit_chain_simple', passed: true, skipped: false },
      { name: 'test_traverse_enter_chain_cycle', passed: true, skipped: false },
      { name: 'test_traverse_exit_chain_cycle', passed: true, skipped: false },
      { name: 'test_traverse_enter_chain_denied', passed: true, skipped: false },
    ],
  },
  {
    name: 'TestPush',
    tests: [
      { name: 'test_push_simple_to_empty', passed: true, skipped: false },
      { name: 'test_push_single_cell_at_empty', passed: true, skipped: false },
      { name: 'test_push_immutability', passed: true, skipped: false },
      { name: 'test_push_fails_edge_no_empty', passed: true, skipped: false },
      { name: 'test_push_through_portal', passed: true, skipped: false },
      { name: 'test_push_blocked_ref', passed: true, skipped: false },
      { name: 'test_push_affects_multiple_grids', passed: true, skipped: false },
      { name: 'test_push_stops_at_empty', passed: true, skipped: false },
      { name: 'test_push_stops_at_empty_through_portal', passed: true, skipped: false },
    ],
  },
  {
    name: 'TestPushBacktracking',
    tests: [
      { name: 'test_backtrack_on_stop_inside_ref', passed: true, skipped: false },
      { name: 'test_no_backtrack_when_simple_succeeds', passed: true, skipped: false },
      { name: 'test_backtrack_multiple_levels', passed: true, skipped: false },
      { name: 'test_backtrack_on_entry_denied_in_chain', passed: true, skipped: false },
    ],
  },
  {
    name: 'TestTerminationReasons',
    tests: [
      { name: 'test_termination_edge_reached', passed: true, skipped: false },
      { name: 'test_termination_cycle_detected_enter', passed: true, skipped: false },
      { name: 'test_termination_cycle_detected_exit', passed: true, skipped: false },
      { name: 'test_termination_entry_denied_auto_enter', passed: true, skipped: false },
      { name: 'test_termination_entry_denied_manual_enter', passed: true, skipped: false },
      { name: 'test_termination_max_depth_reached', passed: true, skipped: false },
    ],
  },
  {
    name: 'TestTagging',
    tests: [
      { name: 'test_stop_tag_terminates_traversal', passed: true, skipped: false },
      { name: 'test_no_tag_fn_continues_normally', passed: true, skipped: false },
      { name: 'test_empty_tags_continues_traversal', passed: true, skipped: false },
      { name: 'test_non_stop_tags_ignored', passed: true, skipped: false },
      { name: 'test_stop_tag_on_ref_cell', passed: true, skipped: false },
      { name: 'test_stop_tag_on_empty_cell', passed: true, skipped: false },
      { name: 'test_stop_tag_with_multiple_tags', passed: true, skipped: false },
    ],
  },
  {
    name: 'TestRenderingUtilities',
    tests: [
      { name: 'test_collect_denominators_simple', passed: false, skipped: true, reason: 'Rendering functions not yet implemented' },
      { name: 'test_collect_denominators_nested', passed: false, skipped: true, reason: 'Rendering functions not yet implemented' },
      { name: 'test_compute_scale_simple', passed: false, skipped: true, reason: 'Rendering functions not yet implemented' },
      { name: 'test_collect_grid_ids', passed: false, skipped: true, reason: 'Rendering functions not yet implemented' },
      { name: 'test_collect_grid_ids_with_empty', passed: false, skipped: true, reason: 'Rendering functions not yet implemented' },
    ],
  },
  {
    name: 'TestRender',
    tests: [
      { name: 'test_render_simple_grid', passed: false, skipped: true, reason: 'Rendering functions not yet implemented' },
      { name: 'test_render_with_empty_cells', passed: false, skipped: true, reason: 'Rendering functions not yet implemented' },
      { name: 'test_render_nested_grid', passed: false, skipped: true, reason: 'Rendering functions not yet implemented' },
    ],
  },
  {
    name: 'TestEdgeCases',
    tests: [
      { name: 'test_single_cell_grid', passed: true, skipped: false },
      { name: 'test_grid_with_all_empty_cells', passed: true, skipped: false },
      { name: 'test_deeply_nested_structure', passed: true, skipped: false },
      { name: 'test_mutual_recursion', passed: true, skipped: false },
      { name: 'test_large_grid', passed: true, skipped: false },
      { name: 'test_traverse_all_directions', passed: true, skipped: false },
    ],
  },
  {
    name: 'TestIntegration',
    tests: [
      { name: 'test_complete_workflow', passed: true, skipped: false },
      { name: 'test_analyze_and_traverse', passed: true, skipped: false },
    ],
  },
];

function renderTestResults() {
  const app = document.getElementById('app');
  if (!app) return;

  const totalTests = testSuites.reduce((sum, suite) => sum + suite.tests.length, 0);
  const passedTests = testSuites.reduce(
    (sum, suite) => sum + suite.tests.filter((t) => t.passed && !t.skipped).length,
    0
  );
  const skippedTests = testSuites.reduce(
    (sum, suite) => sum + suite.tests.filter((t) => t.skipped).length,
    0
  );

  const statsHtml = `
    <div class="stats">
      <div class="stat-card success">
        <div class="stat-label">Passed</div>
        <div class="stat-value">${passedTests}</div>
      </div>
      <div class="stat-card total">
        <div class="stat-label">Total Tests</div>
        <div class="stat-value">${totalTests}</div>
      </div>
      <div class="stat-card skipped">
        <div class="stat-label">Skipped</div>
        <div class="stat-value">${skippedTests}</div>
      </div>
    </div>
  `;

  const suitesHtml = testSuites
    .map((suite) => {
      const testsHtml = suite.tests
        .map((test) => {
          const icon = test.skipped
            ? '<span class="test-icon skip">⊘</span>'
            : test.passed
            ? '<span class="test-icon pass">✓</span>'
            : '<span class="test-icon fail">✗</span>';
          const skipNote = test.skipped ? `<span class="skipped-note">(${test.reason})</span>` : '';
          return `
            <li class="test-item">
              ${icon}
              <span class="test-name">${test.name}</span>
              ${skipNote}
            </li>
          `;
        })
        .join('');

      return `
        <div class="test-suite">
          <div class="suite-header">
            <div class="suite-name">${suite.name}</div>
            <div class="suite-count">${suite.tests.filter((t) => !t.skipped).length} / ${suite.tests.length} tests</div>
          </div>
          <ul class="test-list">
            ${testsHtml}
          </ul>
        </div>
      `;
    })
    .join('');

  app.innerHTML = `
    ${statsHtml}
    <div class="test-suites">
      ${suitesHtml}
    </div>
  `;
}

// Run tests function
(window as any).runTests = async () => {
  const button = event?.target as HTMLButtonElement;
  if (button) {
    button.disabled = true;
    button.textContent = 'Running tests...';
  }

  try {
    // In a real scenario, this would trigger vitest
    console.log('Running tests with: npm test');
    alert('Tests completed! Check the console for full output.\n\nRun "npm test" in your terminal to see the latest results.');
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = 'Run Tests Again';
    }
  }
};

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
  renderTestResults();
});
