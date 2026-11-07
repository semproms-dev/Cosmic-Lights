/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import babel from '@rolldown/plugin-babel'

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages serves this project below /Cosmic-Lights/; local builds stay at /.
  base: process.env.VITE_BASE_PATH ?? '/',
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
