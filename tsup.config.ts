import { defineConfig } from 'tsup';

// 多端构建：
//   dist/node/      — Node ≥18 (ESM + CJS + .d.ts)
//   dist/browser/   — 浏览器 (ESM only, 仅 fetch + WebSocket + LocalStorage)
//   dist/           — Deno/Bun 通用 (ESM)
//
// exports 字段在 package.json 按运行时分发。
export default defineConfig([
  {
    entry: {
      index: 'src/index.ts',
      'adapters/anthropic': 'src/adapters/anthropic.ts',
      'adapters/openai': 'src/adapters/openai.ts',
      'sanitize/index': 'src/sanitize/index.ts',
    },
    outDir: 'dist/node',
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
    sourcemap: true,
    target: 'node18',
    splitting: false,
    treeshake: true,
  },
  {
    entry: { index: 'src/browser.ts' },
    outDir: 'dist/browser',
    format: ['esm'],
    dts: false,
    clean: false,
    sourcemap: true,
    target: 'es2022',
    splitting: false,
    treeshake: true,
    platform: 'browser',
  },
  {
    entry: { index: 'src/index.ts' },
    outDir: 'dist',
    format: ['esm'],
    dts: false,
    clean: false,
    sourcemap: true,
    target: 'es2022',
    splitting: false,
    treeshake: true,
  },
]);
