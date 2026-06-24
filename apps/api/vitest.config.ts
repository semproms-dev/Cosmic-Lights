import swc from 'unplugin-swc'
import { defineConfig } from 'vitest/config'

// NestJS relies on decorator metadata, so tests are compiled with SWC.
export default defineConfig({
  plugins: [swc.vite()],
  // SWC handles transformation, so disable Vite's built-in Oxc transformer.
  oxc: false,
  test: {
    globals: true,
    environment: 'node',
    root: './',
    include: ['src/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
})
