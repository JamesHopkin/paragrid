/**
 * Main entry point for the Paragrid Level Editor
 */

import { onStateChange, loadFromServer, getState } from './state.js';
import { renderGrids, initializeUI, updateHistoryStatus, selectCellByCoords } from './ui.js';

/**
 * Initialize the editor
 */
async function init(): Promise<void> {
  // Try to load current state from server
  console.log('🔄 Loading current state from server...');
  const result = await loadFromServer();

  if (result.success) {
    console.log(`✅ Loaded server state (v${result.version})`);
  } else {
    console.log('📦 Server not available, using default state');
  }

  // Set up state change listener to re-render and update history
  onStateChange(() => {
    renderGrids();
    updateHistoryStatus();
  });

  // Initialize UI event listeners
  initializeUI();

  // Initial render
  renderGrids();

  // Select first cell (0, 0) of first grid if it exists
  const state = getState();
  const firstGridId = state.gridOrder[0];
  if (firstGridId) {
    selectCellByCoords(firstGridId, 0, 0);
  }

  console.log('🚀 Paragrid Level Editor initialized');
}

// Start the editor when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
