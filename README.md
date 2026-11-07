# CosmicLights

A web application for processing RAW photos and exporting JPGs — aiming to offer features comparable to Lightroom, RapidRAW and Darktable.

At the moment this is just a hobby. I wanted a free Lightroom-style app to run on my own browser so I can edit pictures in an easy and quick way. Probably later I will go with a full Desktop application, if life me allows me to.

Feel free to try and clone the repo and modify it as you want!

## Architecture

**pnpm workspace monorepo** (`apps/*`):

| App | Stack | Role |
|-----|-------|------|
| `apps/web` | React 19 + Vite + TanStack Router + Mantine 9 | Frontend UI |
| `apps/api` | NestJS 11 + Express | Backend API |

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

### Backend (`apps/api`)

| Tool | Version |
|------|---------|
| NestJS | ^11.0.1 |
| Express | (platform-express) |
| TypeScript | ^5.7.3 |
| vitest | ^4.1.9 |
| SWC | (decorator transforms) |
| Supertest | ^7.0.0 |

## Getting Started

```bash
pnpm install     # install all workspace dependencies
pnpm dev         # run both apps in parallel (web + api)
```

- **Web:** http://localhost:5173
- **API:** http://localhost:3000

### Per-app dev

```bash
pnpm --filter web dev        # frontend only
pnpm --filter api start:dev  # backend only
```

## Scripts

### Root (applies to all workspaces)

| Script | Description |
|--------|-------------|
| `pnpm dev` | Both apps in parallel |
| `pnpm build` | Build all workspaces |
| `pnpm test` | Test all workspaces |
| `pnpm lint` | Lint all workspaces |

### Web (`apps/web`)

| Script | Description |
|--------|-------------|
| `pnpm --filter web dev` | Start Vite dev server |
| `pnpm --filter web build` | Type-check + Vite build |
| `pnpm --filter web test` | Run tests (vitest) |
| `pnpm --filter web test:watch` | Watch mode |
| `pnpm --filter web test:coverage` | With coverage |
| `pnpm --filter web exec vitest run src/routes/index.test.tsx` | Single test file |

### API (`apps/api`)

| Script | Description |
|--------|-------------|
| `pnpm --filter api start:dev` | Watch mode |
| `pnpm --filter api build` | NestJS build |
| `pnpm --filter api start:prod` | Production start |
| `pnpm --filter api test` | Unit tests |
| `pnpm --filter api test:cov` | With coverage |
| `pnpm --filter api test:e2e` | E2E tests |

## Project Structure

```
apps/
├── api/                          # NestJS backend
│   ├── src/
│   │   ├── main.ts               # Bootstrap (custom Logger, try/catch)
│   │   ├── app.module.ts         # Root module
│   │   ├── app.controller.ts     # Controller (GET /)
│   │   ├── app.service.ts        # Business logic
│   │   ├── app.controller.spec.ts
│   │   └── logger.ts             # ConsoleLogger wrapper
│   ├── test/
│   │   └── app.e2e-spec.ts
│   ├── vitest.config.ts
│   └── vitest.config.e2e.ts
│
└── web/                          # React frontend
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
        │   ├── __root.tsx        # Root layout (Outlet + Devtools)
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

Both apps use **vitest** with `globals: true` and 80% coverage thresholds.

| App | Environment | Key Setup |
|-----|-------------|-----------|
| Web | jsdom | `setup.ts` mocks `scrollIntoView`, `matchMedia`, `ResizeObserver`; `render.tsx` wraps in `MantineProvider` |
| API | node | `@nestjs/testing` for unit tests; supertest + full app boot for e2e |

## Conventions

- **Naming:** `camelCase` for variables/functions, `PascalCase` for components/classes
- **Typing:** No `any`. All function signatures fully typed. Strict TypeScript mode enabled.
- **Error handling:** Every async function wraps its body in `try/catch` and logs via the `logger` utility
- **Logging:** Use the `logger` module — never `console.log` in production code
- **JSDoc:** Required on all public-facing APIs
- **Source files:** Not committed — `.eslintrc.*`, `tsconfig.json` files require explicit approval to modify

## Logger

Both apps provide a level-gated logger:

- **Web:** `src/logger.ts` — levels `debug` / `info` / `warn` / `error`. Silences `debug`/`info` in production. Level overridable via `VITE_LOG_LEVEL` env var.
- **API:** `src/logger.ts` — extends NestJS `ConsoleLogger`. Silences `debug`/`verbose` in production.

## Environment Variables

### Web
| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_LOG_LEVEL` | `debug` (dev) / `warn` (prod) | Minimum log level |

### API
| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `NODE_ENV` | `development` | Controls log level verbosity |
