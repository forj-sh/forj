import { defineConfig } from 'tsup';
import { builtinModules } from 'node:module';

const nodeBuiltins = builtinModules.flatMap((mod) => [mod, `node:${mod}`]);

export default defineConfig({
  entry: ['src/index.ts', 'src/start-workers.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  minify: false,
  target: 'node18',
  outDir: 'dist',
  external: ['pg', 'ioredis', 'ws', '@neondatabase/serverless', ...nodeBuiltins],
});
