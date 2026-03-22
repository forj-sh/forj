import { defineConfig } from 'vite';
import { resolve } from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        success: resolve(__dirname, 'success.html'),
        cancel: resolve(__dirname, 'cancel.html'),
        docs: resolve(__dirname, 'docs.html'),
      },
    },
  },
  server: {
    port: 3000,
    open: true,
  },
  preview: {
    port: 4173,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
});
