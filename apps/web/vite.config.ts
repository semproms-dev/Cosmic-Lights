/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import babel from '@rolldown/plugin-babel'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    // The router plugin must come before the React plugin.
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
      routeFileIgnorePattern: '\\.(test|spec)\\.[tj]sx?$',
    }),
    babel({
      presets: [reactCompilerPreset()],
    }),
    react(),
  ],
  server: {
    proxy: {
      // Bird identification service (mask type "identify"). It is a separate
      // local Flask app that sends no CORS headers, so the browser refuses to
      // read its answer when called directly. Forwarding it here makes the call
      // same-origin, which sidesteps CORS entirely and lets the real status code
      // reach the console instead of a blanket network error.
      //
      // DEV ONLY: a production build needs a real proxy in front, or CORS
      // enabled in the service. Override the target with BIRD_API_TARGET.
      // Remove this block (and `editor/birds/`) to retire the feature.
      '/api/birds': {
        target: process.env.BIRD_API_TARGET ?? 'http://127.0.0.1:5000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/birds/, '/api/v1'),
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // Process CSS so CSS-module imports (e.g. *.module.css) resolve to a real
    // class-name object instead of being stubbed out.
    css: true,
    coverage: {
      provider: 'v8',
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
})
