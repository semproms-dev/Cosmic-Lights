import tiffWasm from '@crossbind/port-tiff-wasm/crossbind.config.js'

export default {
  dependencies: [tiffWasm],
  paths: {
    config: import.meta.url,
    // Mount the repository root so Docker can see pnpm's root node_modules
    // and the crossbind runtime used by this monorepo.
    base: '../..',
  },
  dts: 'promise',
}
