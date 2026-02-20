# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with this project.

## Build & Development Commands

All commands run from the project root:

```bash
npm run install-all        # Install deps for root + backend + frontend
npm run dev                # Start backend (tsx watch) + frontend (Vite) concurrently
npm run build              # Build both for production
npm run dev:backend        # Backend only (tsx watch on port 3000)
npm run dev:frontend       # Frontend only (Vite HMR)
npm run start              # Start production server (serves frontend from port 5000)
```

**Frontend lint:** `cd frontend && npm run lint`

**Backend clean:** `cd backend && npm run clean`

## Docker Build & Test (Primary Workflow)

CIC is designed to be tested via Docker, not just the local dev server. The Docker build serves the production app on port 5000.

```powershell
docker compose -f docker/docker-compose.yml down
docker compose -f docker/docker-compose.yml up --build -d
# App available at http://localhost:5000 (frontend + API at /api/*)
```

**Kubernetes redeploy:** `helm\redeploy.bat` (builds image and redeploys to the `container-image-compare` namespace).

## E2E Testing with Puppeteer

Location: `e2e/`

**Mandatory testing protocol** — test before AND after code changes:
1. Start Docker containers (`docker compose up -d --build`)
2. Run a Puppeteer test: `cd e2e && node test-file.js`
3. Make code changes
4. Rebuild: `docker compose down && docker compose up -d --build`
5. Re-run the same test; compare before/after screenshots

Test conventions:
- Use `headless: false` during development to see the browser
- Target `http://localhost:5000` (never port 3000)
- Capture console logs with `page.on('console', ...)` and errors with `page.on('pageerror', ...)`
- Take screenshots to `e2e/screenshots/` named `{test-name}-{step}-{timestamp}.png`
- Use `page.evaluate()` for button clicks; use `setTimeout` promises for delays (not `page.waitForTimeout`)
- UI: single image shows "INSPECT IMAGE" button; two images shows "COMPARE IMAGES"
- Remind user to clean up `e2e/screenshots/` before ending sessions

## Architecture

```
frontend/ (React + Vite + MUI + Zustand)
    ↕ HTTP + WebSocket
backend/  (Express + Node.js)
    ↕
External: Docker registries (HTTP API v2), Podman (container terminal)
    ↕
Local FS: cache/ (image layers, LRU eviction), data/ (settings, history, encrypted credentials)
```

**No external database** — all persistence is file-based.

### Backend Service Layer (`backend/src/services/`)
- `registryClient.ts` — Docker Registry HTTP API v2 auth & manifest fetching
- `imageCacheOCI.ts` — Downloads, extracts, and caches OCI image layers (LRU eviction)
- `comparison.ts` — Generates metadata & filesystem diffs between images
- `containerTerminal.ts` — Interactive container sessions via Podman
- `terminalWebSocket.ts` — WebSocket handler for terminal I/O (uses node-pty)
- `history.ts` / `settings.ts` / `credentials.ts` — Persistence services

### Frontend Structure (`frontend/src/`)
- **Pages:** `pages/` — HomePage, ComparisonPage, HistoryPage, SettingsPage
- **Components:** `components/` — FilesystemView, FileContentDiff, FileTree, MetadataView, ContainerTerminal, etc.
- **State:** `store/` — Zustand stores (comparison, containerTerminal, settings)

### Shared Types
`shared/types.ts` defines all API contracts. Imported by both frontend and backend via relative paths:
```typescript
// From backend:  import { ComparisonResult } from '../../shared/types';
// From frontend: import { ComparisonResult } from '../../../shared/types';
```

### Routes → API
Backend routes in `backend/src/routes/*.ts` map to `/api/*` endpoints. API responses are always JSON; errors return `{ error: string }`.

## Code Conventions

**Logging (backend):** Use the component-scoped logger, never `console.log`:
```typescript
import { createLogger } from '../utils/logger';
const logger = createLogger('ComponentName');
logger.info('message', { data }); // Levels: debug, info, warn, error
```

**State management (frontend):** Use Zustand stores from `frontend/src/store/`:
```typescript
import { useComparisonStore } from '../store/comparison';
const { currentComparison, loading } = useComparisonStore();
```

**Container terminal feature:** Requires Podman in Docker (privileged mode). Code sections are marked with `CONTAINER RUNTIME DEPENDENCY` comments. Check availability via `containerTerminalService.getRuntime()`.
