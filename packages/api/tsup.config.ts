import { defineConfig } from 'tsup';
import { builtinModules } from 'node:module';

// Externalize all Node.js builtins (both 'crypto' and 'node:crypto' forms)
const nodeBuiltins = builtinModules.flatMap((mod) => [mod, `node:${mod}`]);

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: false,
  clean: true,
  sourcemap: true,
  minify: false,
  target: 'node18',
  outDir: 'dist',
  external: ['pg', 'ioredis', 'ws', '@neondatabase/serverless', ...nodeBuiltins],
});
