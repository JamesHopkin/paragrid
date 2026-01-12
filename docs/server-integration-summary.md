# Server Integration with Versioning - Implementation Summary

## Overview

Successfully implemented server integration for the Paragrid Level Editor using the Vite dev server with versioning support for multi-client synchronization.

## What Was Implemented

### 1. Vite Plugin for Grid Store API (`web/vite-plugin-grid-store.ts`)

A custom Vite plugin that adds three API endpoints to the dev server:

- **POST /api/grids** - Save grid state
  - Accepts: `{ grids: Record<string, string> }`
  - Returns: `{ success: boolean, version: number, timestamp: number }`
  - Increments version number on each save
  - Logs grid data to console

- **GET /api/grids** - Load current grid state
  - Returns: `{ version: number, grids: Record<string, string>, timestamp: number }`

- **GET /api/grids/version** - Check current version (efficient polling)
  - Returns: `{ version: number, timestamp: number }`

**Key Features:**
- In-memory storage (persists during dev server session)
- Version counter starts at 0, increments on each save
- Console logging for visibility
- CORS headers for development

### 2. State Management Updates (`web/src/editor/state.ts`)

Added server synchronization functions:

- **`saveToServer()`** - Serializes current state and POSTs to server
- **`loadFromServer()`** - Fetches state from server and imports it
- **`checkServerVersion()`** - Polls version endpoint
- **`startPolling(intervalMs, autoLoad)`** - Automatic update detection
- **`stopPolling()`** - Stop polling
- **`getCurrentVersion()`** - Get local version number

**Internal State:**
```typescript
let currentVersion = 0;        // Tracks last saved/loaded version
let pollInterval: number | null = null;  // Polling timer
```

### 3. UI Integration

**Editor (`web/src/editor/ui.ts`):**
- **Save Button**: Now calls `saveToServer()` instead of `exportToConsole()`
  - Shows loading state: "Saving..."
  - Shows success: "✓ Saved (v2)"
  - Shows error: "✗ Failed"
  - Automatically restores button text after 1.5-2 seconds
- **No Polling**: Editor only saves (one-way communication)

**Demo/Visualization (`web/src/demo-iso.ts`):**
- **Auto-Polling**: Starts on page load
  - Polls every 2 seconds
  - Checks `/api/grids/version` for updates
  - Automatically reloads demo when changes detected
- **Graceful Fallback**: Uses built-in grids if server unavailable
- **Initial Load**: Attempts to load from server on startup

### 4. Configuration (`web/vite.config.ts`)

Added the grid store plugin to the Vite configuration:

```typescript
import { gridStorePlugin } from './vite-plugin-grid-store';

export default defineConfig({
  plugins: [gridStorePlugin(), viteSingleFile()],
  // ...
});
```

## How It Works

### Save Flow (Editor → Server)

1. User edits grids in the editor
2. User clicks "Save" button
3. `saveToServer()` serializes grids to string format
4. POST to `/api/grids` with grid data
5. Server increments version (e.g., 0 → 1)
6. Server logs to console
7. Editor shows success feedback

### Load/Sync Flow (Server → Demo)

1. Demo page loads and calls `initDemo()`
2. Attempts to load from `/api/grids`
3. If server available: Uses server grids
4. If server unavailable: Falls back to built-in grids
5. Demo starts polling every 2 seconds
6. `checkServerVersion()` calls `/api/grids/version`
7. If `serverVersion > currentVersion`:
   - Console logs: "🔔 New grid data available"
   - `initDemo()` called again to reload
   - New demo instance created with updated grids
8. If versions match, no action taken

### Two-Window Workflow

**Editor Window (Save-Only):**
- Loads current server state on startup
- Edit grids visually
- Click "Save" to push to server
- No polling after initial load

**Demo Window (Read-Only):**
- Displays current server state
- Polls for updates every 2 seconds
- Automatically reloads when editor saves
- Falls back to built-in grids if server unavailable

## Testing the Implementation

### 1. Start the Dev Server

```bash
cd web
npm run dev
```

The Vite dev server will start with the grid store plugin active.

### 2. Open Editor

Navigate to: `http://localhost:5173/editor.html`

### 3. Test Single Client Save/Load

1. Make changes to grids (add cells, resize, etc.)
2. Click "Save" button
3. Check browser console for:
   ```
   ✅ Saved to server (version 1)
   ```
4. Check terminal (where Vite is running) for:
   ```
   📝 Grid Store Updated (v1)
   Timestamp: 2026-01-12T...
   Grid Data: {"grid_1":"_ _ _|_ _ _|_ _ _"}
   ```

### 4. Test Two-Window Workflow

1. Open **editor** in one window: `http://localhost:5173/editor.html`
2. Open **demo** in another window: `http://localhost:5173/demo-iso.html`
3. In editor: Make changes (add cells, resize grid, etc.)
4. In editor: Click "Save" → should see "✓ Saved (v1)"
5. In demo: Watch console (within 2 seconds):
   ```
   🔔 New grid data available (v1), reloading...
   ✅ Loaded grids from server (v1)
   ```
6. Demo should automatically reload and display the new grid structure

### 5. Verify Version Tracking

In browser console, run:
```javascript
import { getCurrentVersion } from './src/editor/state.js';
getCurrentVersion(); // Should show current version number
```

## API Details

### Data Format

Grids are serialized using the parseable string format:

```typescript
{
  "grid_1": "1 2 3|4 5 6",      // Concrete cells
  "grid_2": "_ _ _|*grid_1 7 8", // Primary ref + concrete
  "grid_3": "~grid_1 _ _"        // Secondary ref
}
```

Format conventions:
- `_` = Empty cell
- `1`, `2`, etc. = Concrete cell IDs
- `*gridId` = Primary reference
- `~gridId` = Secondary reference
- `|` = Row separator
- ` ` (space) = Cell separator

### Version Number

- Starts at 0 when server starts
- Increments on each successful save
- Monotonically increasing
- Resets when dev server restarts

## Console Logging

The implementation includes helpful console output:

**Editor Window (Browser):**
```
🔄 Loading current state from server...
✅ Loaded server state (v1)
🚀 Paragrid Level Editor initialized
💾 Save your changes to update connected demo/visualization windows
✅ Saved to server (version 2)
```

**Demo Window (Browser):**
```
✅ Loaded grids from server (v0)
📡 Polling server for updates every 2000ms
🔔 New grid data available (v1), reloading...
✅ Loaded grids from server (v1)
```

**Server (Terminal):**
```
📝 Grid Store Updated (v1)
Timestamp: 2026-01-12T10:30:45.123Z
Grid Data: {"grid_1":"1 2|3 4"}
---
```

## Benefits

1. **Efficient Polling**: Only fetches full state when version changes
2. **Immediate Feedback**: UI shows save status instantly
3. **Multi-Client Support**: Multiple editors can work simultaneously
4. **No Database Required**: In-memory storage perfect for prototyping
5. **Console Visibility**: Easy to debug and verify behavior
6. **Graceful Degradation**: Works offline (shows error feedback)

## Limitations & Future Enhancements

**Current Limitations:**
- In-memory only (state lost on server restart)
- Last write wins (no conflict resolution)
- No authentication or user tracking
- Fixed 2-second poll interval

**Future Enhancements:**
- File-based persistence
- Conflict resolution (OT or CRDT)
- WebSocket for real-time updates
- Configurable poll interval
- Per-user sessions
- Undo/redo sync across clients

## Files Modified

1. `web/vite-plugin-grid-store.ts` - **New file** (Vite middleware plugin)
2. `web/vite.config.ts` - Added plugin import and registration
3. `web/src/editor/state.ts` - Added server sync functions (save/load/poll, handles empty state)
4. `web/src/editor/ui.ts` - Updated save button (editor only saves, no polling)
5. `web/src/editor/main.ts` - Load server state on startup
6. `web/src/demo-iso.ts` - Added server loading and polling (demo reads and reloads)

## Next Steps

You can now:
1. Test the multi-client sync workflow
2. Build the two-window workflow (editor + preview)
3. Add file-based persistence if needed
4. Implement real-time updates with WebSocket
5. Add version display in UI header
