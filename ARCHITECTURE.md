# Container Image Compare - Architecture Overview

## System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                          USER BROWSER                                │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                    FRONTEND (React + Vite)                     │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐│  │
│  │  │  Home Page   │  │ Comparison   │  │ History / Settings   ││  │
│  │  │              │  │   View       │  │                      ││  │
│  │  │ - Input URLs │  │ - Metadata   │  │ - Past comparisons   ││  │
│  │  │ - Credentials│  │ - File Tree  │  │ - Configuration      ││  │
│  │  │ - Start Comp │  │ - File Diff  │  │ - Credentials        ││  │
│  │  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘│  │
│  │         │                 │                      │             │  │
│  │         └─────────────────┴──────────────────────┘             │  │
│  │                           │                                    │  │
│  │                    ┌──────▼──────┐                            │  │
│  │                    │   Zustand   │  State Management          │  │
│  │                    │   Stores    │                            │  │
│  │                    └──────┬──────┘                            │  │
│  │                           │                                    │  │
│  └───────────────────────────┼────────────────────────────────────┘  │
│                              │ HTTP/REST API                         │
└──────────────────────────────┼───────────────────────────────────────┘
                               │
                               │ http://localhost:5000/api
                               │
┌──────────────────────────────▼───────────────────────────────────────┐
│                    BACKEND (Node.js + Express)                       │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │                      API ROUTES                                 │ │
│  │  /api/comparison  /api/history  /api/settings  /api/cache     │ │
│  │  /api/credentials /api/download                                │ │
│  └────────────────────────┬───────────────────────────────────────┘ │
│                           │                                          │
│  ┌────────────────────────▼───────────────────────────────────────┐ │
│  │                     SERVICES LAYER                              │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐  │ │
│  │  │   Registry   │  │    Image     │  │    Comparison      │  │ │
│  │  │    Client    │  │    Cache     │  │     Engine         │  │ │
│  │  │              │  │              │  │                    │  │ │
│  │  │ - Auth       │  │ - Download   │  │ - Metadata Diff    │  │ │
│  │  │ - Manifest   │  │ - Extract    │  │ - Filesystem Diff  │  │ │
│  │  │ - Layers     │  │ - File Tree  │  │ - Content Diff     │  │ │
│  │  │ - Config     │  │ - LRU Cache  │  │ - Status Tracking  │  │ │
│  │  └──────┬───────┘  └──────┬───────┘  └──────┬─────────────┘  │ │
│  │         │                 │                  │                 │ │
│  │  ┌──────▼─────────────────▼──────────────────▼─────────────┐  │ │
│  │  │            History        Settings      Credentials      │  │ │
│  │  │            Service        Service       Service          │  │ │
│  │  └─────────────────────────────────────────────────────────┘  │ │
│  └────────────────────────┬───────────────────────────────────────┘ │
│                           │                                          │
└───────────────────────────┼──────────────────────────────────────────┘
                            │
                            │ File System Access
                            │
┌───────────────────────────▼──────────────────────────────────────────┐
│                      LOCAL FILE SYSTEM                               │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────────┐ │
│  │    cache/    │  │    data/     │  │      data/history/        │ │
│  │              │  │              │  │                           │ │
│  │ <image1>/    │  │ settings.json│  │ <comparison-id-1>.json    │ │
│  │  - metadata  │  │              │  │ <comparison-id-2>.json    │ │
│  │  - filesystem│  │ credentials  │  │ ...                       │ │
│  │              │  │  .json       │  │                           │ │
│  │ <image2>/    │  │              │  │                           │ │
│  │  - ...       │  │              │  │                           │ │
│  └──────────────┘  └──────────────┘  └───────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
                            │
                            │ Docker Registry HTTP API v2
                            │
┌───────────────────────────▼──────────────────────────────────────────┐
│                    CONTAINER REGISTRIES                              │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────────┐ │
│  │  Docker Hub  │  │     GHCR     │  │    Private Registries     │ │
│  │              │  │              │  │                           │ │
│  │ docker.io    │  │ ghcr.io      │  │ registry.company.com      │ │
│  │              │  │              │  │                           │ │
│  │ - Manifests  │  │ - Manifests  │  │ - Manifests               │ │
│  │ - Layers     │  │ - Layers     │  │ - Layers                  │ │
│  │ - Config     │  │ - Config     │  │ - Config                  │ │
│  └──────────────┘  └──────────────┘  └───────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

## Data Flow: Image Comparison Process

```
1. USER INPUT
   └─> Enter leftImage: "nginx:1.25.0"
   └─> Enter rightImage: "nginx:1.26.0"
   └─> Click "Compare"

2. FRONTEND
   └─> POST /api/comparison
       Body: { leftImage, rightImage, credentialIds }

3. BACKEND - REGISTRY CLIENT
   ├─> Authenticate with registry (Bearer token)
   ├─> GET /v2/library/nginx/manifests/1.25.0
   ├─> GET /v2/library/nginx/manifests/1.26.0
   └─> Parse manifest schemas

4. BACKEND - IMAGE CACHE
   ├─> Check if cached: cache/<hash>/metadata.json
   │   ├─> IF CACHED: Load from disk
   │   └─> IF NOT:
   │       ├─> Download config blob
   │       ├─> Download all layers (gzipped tars)
   │       ├─> Extract layers sequentially
   │       ├─> Build filesystem tree
   │       └─> Save to cache/

5. BACKEND - COMPARISON ENGINE
   ├─> Compare Metadata:
   │   ├─> User, Entrypoint, CMD
   │   ├─> Environment Variables
   │   ├─> Labels
   │   ├─> Exposed Ports
   │   └─> Architecture, OS
   │
   └─> Compare Filesystems:
       ├─> Collect all file paths
       ├─> Determine status (added/removed/modified/same)
       ├─> Build merged tree structure
       └─> Generate FileDiff[] array

6. BACKEND - HISTORY SERVICE
   └─> Save comparison to data/history/<id>.json

7. BACKEND RESPONSE
   └─> Return ComparisonResult JSON

8. FRONTEND - DISPLAY
   ├─> Metadata Tab:
   │   └─> Render tables with diff status
   │
   └─> Filesystem Tab:
       ├─> Render dual-pane file trees
       ├─> Color-code by status
       └─> Enable file selection for content diff

9. USER INTERACTION
   └─> Click file in tree
       └─> POST /api/comparison/file-diff
           ├─> Backend reads file content from cache
           ├─> Generate line-by-line diff
           └─> Return with hunks and line changes
           └─> Frontend renders side-by-side diff
```

## Component Communication

```
┌────────────────────────────────────────────────────────────────┐
│                      FRONTEND COMPONENTS                        │
│                                                                 │
│  HomePage                ComparisonPage              HistoryPage│
│     │                           │                          │    │
│     └──────────┬────────────────┴──────────────────────────┘    │
│                │                                                │
│         ┌──────▼──────┐                                        │
│         │   Zustand   │  Global State                          │
│         │   Stores    │                                        │
│         └──────┬──────┘                                        │
│                │                                                │
│         ┌──────▼──────────────┐                                │
│         │  API Service Layer  │  axios requests                │
│         └──────┬──────────────┘                                │
│                │                                                │
└────────────────┼───────────────────────────────────────────────┘
                 │
                 │ HTTP REST API
                 │
┌────────────────▼───────────────────────────────────────────────┐
│                     BACKEND SERVICES                            │
│                                                                 │
│  Express Routes ──┬──> Registry Client ──> Docker Registry API │
│                   │                                             │
│                   ├──> Image Cache ──────> Local Filesystem    │
│                   │                                             │
│                   ├──> Comparison Engine ─> In-Memory Diff     │
│                   │                                             │
│                   ├──> History Service ───> JSON Files         │
│                   │                                             │
│                   ├──> Settings Service ──> JSON File          │
│                   │                                             │
│                   └──> Credentials ───────> Encrypted JSON     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Key Design Decisions

### 1. **File-Based Storage (No Database)**
   - ✅ Simple deployment
   - ✅ No external dependencies
   - ✅ Easy backup and migration
   - ✅ Human-readable JSON files

### 2. **Caching Strategy**
   - LRU (Least Recently Used) eviction
   - Configurable size limits
   - Hash-based image identification
   - Persistent across restarts

### 3. **Comparison Algorithm**
   - Metadata: Field-by-field comparison
   - Filesystem: Path-based mapping with status tracking
   - Content: Line-by-line diff using library

### 4. **State Management**
   - Zustand for lightweight global state
   - Local component state for UI interactions
   - API responses cached in memory during session

### 5. **API Design**
   - RESTful endpoints
   - JSON request/response
   - Error handling with status codes
   - Stateless (no sessions)

## Performance Characteristics

| Operation | First Time | Cached |
|-----------|-----------|--------|
| Small Image (alpine:3.18, ~7MB) | 5-10s | <1s |
| Medium Image (nginx:1.25, ~150MB) | 30-60s | 1-2s |
| Large Image (postgres:15, ~400MB) | 2-5min | 3-5s |

**Bottlenecks:**
- Network speed (download)
- Disk I/O (extraction)
- CPU (decompression)

**Optimizations:**
- Parallel layer extraction
- Streaming decompression
- Incremental tree building
- Client-side filtering

## Security Model

```
Credentials Flow:
  User Input (plaintext) 
    → Frontend Form
    → POST /api/credentials
    → Backend receives
    → AES-256-CBC encryption
    → Save to credentials.json
    
Credentials Retrieval:
  GET /api/credentials
    → Load from credentials.json
    → Decrypt with key
    → Return (password field omitted in list view)
    → Full credentials only when used for registry auth

Registry Authentication:
  Compare Request
    → Lookup credential by ID
    → Decrypt password
    → Request Bearer token from registry
    → Use token for API calls
    → Token cached for session
```

## Scalability Considerations

**Current Design:**
- ✅ Single-user or small team use
- ✅ Local or small server deployment
- ✅ Handles images up to several GB

**For Large-Scale:**
- Consider Redis for session/cache management
- Add PostgreSQL for structured history
- Implement queue system for concurrent comparisons
- Add horizontal scaling with load balancer
- Use object storage (S3) for cache

## Extension Points

**Easy to Add:**
- New comparison metrics
- Additional metadata fields
- Custom diff algorithms
- Export formats (PDF, CSV)
- API integrations

**Where to Extend:**
- `backend/src/services/comparison.ts` - Comparison logic
- `frontend/src/components/` - UI components
- `backend/src/routes/` - New API endpoints
- `shared/types.ts` - Data structures
