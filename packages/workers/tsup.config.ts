import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/start-workers.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  minify: false,
  target: 'node18',
  outDir: 'dist',
  external: ['pg', 'ioredis', 'ws', '@neondatabase/serverless'],
});
