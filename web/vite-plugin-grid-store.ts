import { Plugin, ViteDevServer } from 'vite';

interface GridStoreState {
  version: number;
  grids: string; // JSON string of grid data
  timestamp: number;
}

export function gridStorePlugin(): Plugin {
  // In-memory store for the dev server
  let state: GridStoreState = {
    version: 0,
    grids: JSON.stringify({}),
    timestamp: Date.now(),
  };

  // Log initial grid store on server start
  console.log('\n🚀 Grid Store Initialized (v' + state.version + ')');
  console.log('Timestamp:', new Date(state.timestamp).toISOString());
  console.log('Grid Data:', state.grids);
  console.log('---\n');

  return {
    name: 'vite-plugin-grid-store',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        // Only handle /api/grids routes
        if (!req.url?.startsWith('/api/grids')) {
          return next();
        }

        // Set CORS headers for development
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
          res.statusCode = 204;
          res.end();
          return;
        }

        if (req.method === 'GET' && req.url === '/api/grids') {
          // Return current grid state with version
          console.log('\n📤 Grid Store Requested (v' + state.version + ')');
          console.log('Timestamp:', new Date(state.timestamp).toISOString());
          console.log('Grid Data:', state.grids);
          console.log('---\n');

          res.setHeader('Content-Type', 'application/json');
          res.statusCode = 200;
          res.end(JSON.stringify({
            version: state.version,
            grids: JSON.parse(state.grids),
            timestamp: state.timestamp,
          }));
          return;
        }

        if (req.method === 'GET' && req.url === '/api/grids/version') {
          // Return just the version for efficient polling
          res.setHeader('Content-Type', 'application/json');
          res.statusCode = 200;
          res.end(JSON.stringify({
            version: state.version,
            timestamp: state.timestamp,
          }));
          return;
        }

        if (req.method === 'POST' && req.url === '/api/grids') {
          // Save new grid state and increment version
          let body = '';
          req.on('data', (chunk) => {
            body += chunk.toString();
          });

          req.on('end', () => {
            try {
              const data = JSON.parse(body);

              // Update state
              state.version += 1;
              state.grids = JSON.stringify(data.grids || {});
              state.timestamp = Date.now();

              // Log to console (as per design doc)
              console.log('\n📝 Grid Store Updated (v' + state.version + ')');
              console.log('Timestamp:', new Date(state.timestamp).toISOString());
              console.log('Grid Data:', state.grids);
              console.log('---\n');

              res.setHeader('Content-Type', 'application/json');
              res.statusCode = 200;
              res.end(JSON.stringify({
                success: true,
                version: state.version,
                timestamp: state.timestamp,
              }));
            } catch (error) {
              res.statusCode = 400;
              res.end(JSON.stringify({
                success: false,
                error: 'Invalid JSON',
              }));
            }
          });
          return;
        }

        next();
      });
    },
  };
}
