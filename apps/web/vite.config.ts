/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import babel from '@rolldown/plugin-babel'
// @ts-expect-error crossbind does not currently ship TypeScript declarations.
import { buildDependencies, createLib, getFilteredBuildTargets, getTargetParams } from 'crossbind'
// @ts-expect-error crossbind's Vite plugin does not currently ship TypeScript declarations.
import viteCrossbindPlugin from '@crossbind/plugin-vite'

const crossbindTargetParams = getTargetParams(
  { platform: ['wasm'], arch: ['wasm32'], runtime: ['st'], runtimeEnv: ['browser'] },
  true,
)

/** Build the small native source library before HMR can relink a changed header. */
const crossbindSourceWarmup = () => ({
  name: 'crossbind-debug-source-warmup',
  apply: 'serve' as const,
  async configureServer() {
    const [target] = getFilteredBuildTargets(crossbindTargetParams, { buildType: 'debug' })
    if (!target) return

    await buildDependencies({
      targetParams: { ...crossbindTargetParams, buildType: [target.buildType] },
    })
    createLib(target, 'Source', { buildSource: true })
  },
})

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
    crossbindSourceWarmup(),
    viteCrossbindPlugin(),
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
