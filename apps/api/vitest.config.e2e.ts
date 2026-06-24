import swc from 'unplugin-swc'
import { defineConfig } from 'vitest/config'

// End-to-end tests boot the full Nest application.
export default defineConfig({
  plugins: [swc.vite()],
  // SWC handles transformation, so disable Vite's built-in Oxc transformer.
  oxc: false,
  test: {
    globals: true,
    environment: 'node',
    root: './',
    include: ['test/**/*.e2e-spec.ts'],
  },
})
