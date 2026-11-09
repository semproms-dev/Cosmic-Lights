# CosmicLights

Welcome to CosmicLights! This is a web application for processing RAW photos and exporting developed images such as JPEG and TIFF — aiming to offer features comparable to Lightroom, RapidRAW and Darktable.

At the moment this is just a hobby. I wanted a free Lightroom-style app to run on my own browser so I can edit pictures in an easy and quick way. Probably later I will go with a full Desktop application, if life me allows me to.

## Privacy and data handling

CosmicLights processes selected photos and editing data in your browser. The web app does not send photo files, masks, or editing settings to a remote service. Photo previews, edits, AI-mask inference, and exports are handled locally in the browser.

AI masks require model files from Hugging Face. The browser downloads them when an AI mask is first used, or if the files are not available locally. That request goes to Hugging Face and may expose ordinary connection information, such as your IP address and browser/device details, as described in [Hugging Face's privacy policy](https://huggingface.co/privacy). CosmicLights runs inference in a browser worker; it does not send the photo to Hugging Face for inference.

When you access a hosted copy of CosmicLights, its hosting or CDN provider also receives the normal requests needed to serve the app and may log connection metadata, depending on its configuration. Exported JPEG and TIFF files can include camera metadata when that option is enabled. GPS coordinates are optional and are off by default.

Feel free to try and clone the repo and modify it as you want!

## Architecture

The web app is built with React 19, Vite, TanStack Router, and Mantine 9.

## Tech Stack

### Frontend (`apps/web`)

| Tool | Version |
|------|---------|
| React | ^19.2.6 |
| TanStack Router | ^1.170.16 |
| Mantine | ^9.4.0 |
| Vite | ^8.0.12 |
| TypeScript | ~6.0.2 |
| vitest | ^4.1.9 |
| Testing Library | ^16.3.2 |
| Zod | ^4.4.3 |

## AI Masks

AI-generated masks run in the web app through Transformers.js; inference happens in a browser worker, using WebGPU when available and falling back to WASM. Models load on demand when an AI mask is first used.

| Mask | Model | Purpose |
|------|-------|---------|
| Subject | [`onnx-community/ormbg-ONNX`](https://huggingface.co/onnx-community/ormbg-ONNX) (IS-Net) | Separates the main subject from the background. |
| Object | [`Xenova/slimsam-77-uniform`](https://huggingface.co/Xenova/slimsam-77-uniform) (SlimSAM) | Selects a prompted object from a click or bounding box. |

Sky masks are not implemented yet and require a semantic segmentation model. Brush and linear/radial gradient masks are created with the app's own editing tools and do not use an AI model.

## TIFF Export

The web app exports TIFF images in the browser. The TIFF encoder is C++ code in `apps/web/src/native/tiff_encoder.h`, compiled to WebAssembly and called from `apps/web/src/components/panels/ExportPanel.tsx`.

### Libraries

- [`@crossbind/port-tiff-wasm`](https://www.npmjs.com/package/@crossbind/port-tiff-wasm) supplies **libtiff** for the WebAssembly build. libtiff writes the TIFF image, LZW compression, and the TIFF/EXIF/GPS directories.
- [`crossbind`](https://www.npmjs.com/package/crossbind) and [`@crossbind/plugin-vite`](https://www.npmjs.com/package/@crossbind/plugin-vite) expose the C++ encoder to TypeScript and integrate its WebAssembly build with Vite. The dependency setup is in `apps/web/crossbind.config.js`; Vite integration is in `apps/web/vite.config.ts`.
- `libraw-wasm` supplies camera metadata when a RAW file is decoded. JPEG metadata is read by `apps/web/src/editor/jpegMetadata.ts`. `apps/web/src/editor/exif.ts` maps those values to the TIFF encoder's payload. The existing `piexifjs` path still embeds EXIF in JPEG exports; TIFF metadata is written by libtiff instead.

Crossbind uses its WebAssembly toolchain through Docker, so Docker must be available when Vite needs to compile or relink the encoder.

### Export flow

1. `ExportPanel` renders the edited, cropped and oriented image with WebGL2, then reads its RGBA pixels with `readPixels`.
2. WebGL returns rows from bottom to top. The panel reverses them and writes the pixel bytes to crossbind's in-memory filesystem (MEMFS), avoiding a large pixel buffer crossing the JavaScript/C++ boundary.
3. The panel calls `TiffEncoder.encodeTiff` with the dimensions, selected bit depth and JSON metadata payload.
4. The encoder converts each RGBA row to opaque RGB and writes a LZW-compressed TIFF. It writes camera make, model, software, artist and orientation in the main TIFF IFD. Exposure time, aperture, focal length, ISO and original date go in the EXIF IFD. GPS coordinates go in a separate GPS IFD only when the user enables the GPS option.
5. The encoder returns the TIFF through MEMFS. The panel saves it with the browser's file picker when supported, or downloads it directly.

The export panel offers **8-bit** and **16-bit** integer samples. The current WebGL readback is 8-bit, so the 16-bit option scales each 8-bit channel by 257 to fill the 16-bit range. This creates a 16-bit TIFF but does not recover additional tonal detail from the RAW sensor; a true high-precision export would require a higher-precision render/readback pipeline.

Camera metadata is included when available and enabled in the export options. GPS is off by default. If the source has no readable metadata, the TIFF is still exported without invented metadata.

## Getting Started

```bash
pnpm install
pnpm --filter web dev
```

- **Web:** http://localhost:5173

## Scripts

### Versioning

The root `package.json` is the source of truth for the app's Semantic Versioning (SemVer) version. Update its `version` for each release (`MAJOR.MINOR.PATCH`): increase MAJOR for incompatible changes, MINOR for backward-compatible features, and PATCH for fixes. Create the matching Git tag as `v<version>` (for example, `v1.0.0`). The web build reads this value from the root manifest, and the About dialog displays it automatically.

### Web (`apps/web`)

| Script | Description |
|--------|-------------|
| `pnpm --filter web dev` | Start Vite dev server |
| `pnpm --filter web build` | Type-check + Vite build |
| `pnpm --filter web test` | Run tests (vitest) |
| `pnpm --filter web test:watch` | Watch mode |
| `pnpm --filter web test:coverage` | With coverage |
| `pnpm --filter web exec vitest run src/routes/index.test.tsx` | Single test file |

## Project Structure

```
apps/
└── web/                          # React web app
    └── src/
        ├── main.tsx              # Entry point
        ├── logger.ts             # Logger utility
        ├── routeTree.gen.ts      # AUTO-GENERATED
        ├── components/
        │   └── navigation/
        │       ├── elements/
        │       │   ├── TopNavBar.tsx
        │       │   └── LateralNavBar.tsx
        │       └── styles/
        │           ├── TopNavBar.module.css
        │           └── LateralNavBar.module.css
        ├── routes/
        │   ├── __root.tsx        # Root layout (Outlet)
        │   ├── index.tsx         # Home page
        │   └── index.test.tsx
        └── test/
            ├── setup.ts          # jsdom mocks (Mantine)
            ├── render.tsx        # Custom render with MantineProvider
            └── NavBar.test.tsx
```

## Routing (Web)

File-based routing via **TanStack Router** Vite plugin. Routes live in `apps/web/src/routes/`. The file `src/routeTree.gen.ts` is **auto-generated** (gitignored) — do not edit by hand.

Test files (`*.test.tsx`, `*.spec.tsx`) in `src/routes/` are excluded from route generation via `routeFileIgnorePattern` in `vite.config.ts`.

## Testing

The web app uses **vitest** with `globals: true` and an 80% coverage threshold.

| App | Environment | Key Setup |
|-----|-------------|-----------|
| Web | jsdom | `setup.ts` mocks `scrollIntoView`, `matchMedia`, `ResizeObserver`; `render.tsx` wraps in `MantineProvider` |

## Conventions

- **Naming:** `camelCase` for variables/functions, `PascalCase` for components/classes
- **Typing:** No `any`. All function signatures fully typed. Strict TypeScript mode enabled.
- **Error handling:** Every async function wraps its body in `try/catch` and logs via the `logger` utility
- **Logging:** Use the `logger` module — never `console.log` in production code
- **JSDoc:** Required on all public-facing APIs
- **Source files:** Not committed — `.eslintrc.*`, `tsconfig.json` files require explicit approval to modify

## Logger

The web app provides a level-gated logger:

- **Web:** `src/logger.ts` — levels `debug` / `info` / `warn` / `error`. Silences `debug`/`info` in production. Level overridable via `VITE_LOG_LEVEL` env var.

## Environment Variables

### Web
| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_LOG_LEVEL` | `debug` (dev) / `warn` (prod) | Minimum log level |

