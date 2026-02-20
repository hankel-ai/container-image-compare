# Container Image Compare - AI Agent Instructions

## ⚠️ ABSOLUTE MANDATORY E2E TESTING PROTOCOL ⚠️

**YOU MUST FOLLOW THIS TESTING PROTOCOL EXACTLY - NO EXCEPTIONS**

### Testing Rules (NO DEVIATIONS ALLOWED):

1. **NEVER skip testing** - If you suggest a fix without testing it, you are violating these instructions
2. **NEVER ask the user to verify** what you can verify yourself with Puppeteer
3. **ALWAYS test before AND after code changes** - This is NOT optional
4. **Test the SAME scenario** before and after to ensure your fix works

### Required Testing Workflow:

#### Step 1: BEFORE Making Changes
```powershell
# Start the app
cd "c:\Users\jhankel\OneDrive - OpenText\VSCode\ai\container-image-compare"
docker compose -f docker/docker-compose.yml down
docker compose -f docker/docker-compose.yml build --nocache
docker compose -f docker/docker-compose.yml up -d

# Wait for startup
Start-Sleep -Seconds 5

# Run E2E test to observe current behavior
cd e2e
node your-test-file.js 2>&1
```

- Review console logs captured in test output
- Examine screenshots in `e2e/screenshots/`
- Identify root cause from error messages

#### Step 2: Make Your Code Changes
- Only now should you modify code
- Document what you changed and why

#### Step 3: AFTER Making Changes (MANDATORY)
```powershell
# Rebuild with your changes
cd "c:\Users\jhankel\OneDrive - OpenText\VSCode\ai\container-image-compare"
docker compose -f docker/docker-compose.yml down
docker compose -f docker/docker-compose.yml up --build -d

# Wait for startup
Start-Sleep -Seconds 5

# Run THE SAME test again
cd e2e
node your-test-file.js 2>&1
```

- Compare before/after screenshots
- Confirm error no longer appears
- Only then report success to user

### Test File Guidelines:
- Use `headless: false` to see the browser window during development
- Capture console logs with `page.on('console', ...)`
- Capture errors with `page.on('pageerror', ...)`
- Take screenshots at each step
- Use `page.evaluate()` to click buttons: `document.querySelectorAll('button').find(btn => btn.textContent.includes('TEXT'))`
- Use `await new Promise(resolve => setTimeout(resolve, milliseconds))` for delays (NOT `page.waitForTimeout`)

## Pre-Change Testing Requirements (MANDATORY - DO NOT SKIP)

Before making ANY code changes, you MUST:
1. **Start the application in Docker** (background mode)
2. **Test current state with Puppeteer** to observe the bug/issue firsthand
3. **Take a "before" screenshot** saved to `e2e/screenshots/`
4. **Make your code changes**
5. **Restart the application** (`docker compose up -d --build`)
6. **Test again with Puppeteer** to confirm the fix
7. **Take an "after" screenshot** to verify the fix

Do NOT ask the user to verify things you can verify yourself with Puppeteer.

## Starting/Stopping the Application

```powershell
# Build and start (background mode - ALWAYS use -d)
cd ai/container-image-compare/docker
docker compose up -d --build

# Check if ready
docker compose ps
Invoke-WebRequest -Uri "http://localhost:5000" -UseBasicParsing -TimeoutSec 5

# View logs
docker compose logs -f

# Rebuild after code changes
docker compose down
docker compose up -d --build

# Stop when done
docker compose down
```

The app runs at `http://localhost:5000` (frontend and API via `/api/*`).

**IMPORTANT**: For local testing, NEVER push to any registry. Use the local Docker image built by `docker compose up --build`.

## Architecture Overview
This is a TypeScript monorepo for comparing Docker/OCI container images:
- **backend/** - Express + Node.js API server (port 3000 dev, 5000 prod)
- **frontend/** - React + Vite + MUI + Zustand (port 5000 dev via proxy)
- **shared/** - Common TypeScript types used by both (`types.ts`)
- **docker/** - Multi-stage Dockerfile with Podman for terminal feature
- **helm/** - Kubernetes deployment chart

## Key Development Commands
```bash
npm run install-all    # Install all dependencies (root, backend, frontend)
npm run dev            # Start both backend and frontend in dev mode
npm run build          # Build both for production
cd backend && npm run dev   # Backend only with tsx watch
cd frontend && npm run dev  # Frontend only with Vite HMR
```

## Critical Patterns

### Logging (Backend)
Always use the component-scoped logger, never `console.log`:
```typescript
import { createLogger } from '../utils/logger';
const logger = createLogger('MyComponent');
logger.info('Message', { optional: 'data' });  // Levels: debug, info, warn, error
```

### State Management (Frontend)
Use Zustand stores in `frontend/src/store/`. Pattern:
```typescript
import { useComparisonStore } from '../store/comparison';
const { currentComparison, loading } = useComparisonStore();
```

### Shared Types
All API contracts live in `shared/types.ts`. Import via relative path:
```typescript
// Backend
import { ComparisonResult } from '../../shared/types';
// Frontend  
import { ComparisonResult } from '../../../shared/types';
```

## Service Layer (backend/src/services/)
- `registryClient.ts` - Docker Registry HTTP API v2 authentication & manifest fetching
- `imageCacheOCI.ts` - Downloads, extracts, and caches OCI image layers
- `comparison.ts` - Generates metadata & filesystem diffs between images
- `containerTerminal.ts` - Creates interactive container sessions (requires Podman)
- `terminalWebSocket.ts` - WebSocket handler for terminal I/O (uses node-pty)

## Container Terminal Feature
This optional feature requires Docker/Podman and is isolated from core comparison logic:
- Check runtime availability: `containerTerminalService.getRuntime()`
- All terminal-related code has prominent `CONTAINER RUNTIME DEPENDENCY` comments
- Uses `node-pty` for real PTY allocation (required for `-it` flags to work)

## Puppeteer Testing

Location: `ai/container-image-compare/e2e/`

### E2E Testing Workflow (MANDATORY)

When investigating bugs or verifying fixes, **ALWAYS** use this workflow to see issues firsthand rather than asking the user to verify manually:

**Step 1: Rebuild and restart the application**
```powershell
cd "c:\Users\jhankel\OneDrive - OpenText\VSCode\ai\container-image-compare"
docker-compose -f docker/docker-compose.yml down
docker-compose -f docker/docker-compose.yml up --build -d
```

**Step 2: Run the Puppeteer test with visible browser**
Example:
```powershell
cd "c:\Users\jhankel\OneDrive - OpenText\VSCode\ai\container-image-compare\e2e"
node test-terminal-fix.js 2>&1
```

**Key principles:**
- Always use `headless: false` so you can see the browser and observe the issue
- Capture console logs from the browser to see JavaScript errors
- Take screenshots at key steps for debugging
- The test should navigate the app just like a user would
- This saves time and prevents manual back-and-forth with the user
- **ALWAYS use `http://localhost:5000`** as the app URL (not port 3000)
- **When tests fail or behave unexpectedly**: Take a screenshot and analyze what's on screen before simplifying the test. Don't blindly create simpler tests - diagnose the actual issue first.
- Create test files in `e2e/` folder following this pattern:

### Screenshot Conventions
- **Directory**: `e2e/screenshots/`
- **Naming**: `{test-name}-{step}-{timestamp}.png`
- Examples: `terminal-test-01-home-2026-01-24T18-37-50.png`


### UI Button Behavior (Important for Tests)
- **Single image specified**: Button displays **"INSPECT IMAGE"**
- **Two images specified**: Button displays **"COMPARE IMAGES"**

When writing E2E tests, use the correct button text based on the test scenario.

## File Conventions
- Backend routes: `backend/src/routes/*.ts` → `/api/*` endpoints
- Frontend pages: `frontend/src/pages/*.tsx` (HomePage, ComparisonPage, etc.)
- Components: `frontend/src/components/*.tsx`
- API responses always JSON; errors include `{ error: string }` body

## Conversation Cleanup Reminder

**IMPORTANT**: Before ending any conversation that involved E2E testing:
- Prompt the user to delete all files in `e2e/screenshots/` directory
- These screenshots accumulate and should not be committed to the repository
- Command: `Remove-Item -Path "e2e/screenshots/*" -Force`
