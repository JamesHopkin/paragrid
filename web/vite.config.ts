import { defineConfig } from 'vite';
import { resolve } from 'path';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { gridStorePlugin } from './vite-plugin-grid-store';

export default defineConfig(({ mode }) => {
  // Determine which HTML file to build based on environment variable
  const input = process.env.BUILD_TARGET === 'demo'
    ? resolve(__dirname, 'demo-iso.html')
    : resolve(__dirname, 'index.html');

  return {
    plugins: [gridStorePlugin(), viteSingleFile()],
    test: {
      globals: true,
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, './src'),
      },
    },
    build: {
      rollupOptions: {
        input,
      },
    },
  };
});
