# Container Image Compare

A full-featured web application for comparing Docker/OCI container images. Compare metadata, environment variables, filesystems, and individual file contents between any two container images with an intuitive dual-pane interface.

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)

## Features

### 🔍 Comprehensive Comparison
- **Metadata Comparison**: Environment variables, user, entrypoint, CMD, working directory, labels, exposed ports, architecture, and OS
- **Filesystem Comparison**: Complete filesystem diff with visual tree navigation
- **File Content Diff**: Line-by-line comparison of text files with syntax highlighting
- **Binary Detection**: Automatically detects and handles binary files

### 🎨 User Interface
- **Dual-Pane View**: Side-by-side comparison with synchronized navigation
- **File Tree Explorer**: Hierarchical view with expand/collapse, status indicators
- **Smart Filtering**: Show only differences, search by filename
- **Synchronized Scrolling**: Navigate through files in sync on both sides
- **Color-Coded Diffs**: Visual indicators for added (green), removed (red), and modified (orange) items

### 💾 Data Management
- **Image Caching**: Downloads images once and caches locally for fast comparisons
- **Configurable Cache**: Set max cache size and location
- **Comparison History**: Save and review past comparisons
- **Download Capabilities**: Export individual files, folders, or entire filesystems

### 🔐 Authentication
- **Registry Credentials**: Support for private registries (Docker Hub, GHCR, etc.)
- **Encrypted Storage**: Credentials stored securely with encryption
- **Per-Image Auth**: Different credentials for each image being compared

### ⚙️ Configuration
- Cache directory and size limits
- History retention settings
- Display preferences (theme, diff view options)
- Search settings (case sensitivity)

## Technology Stack

- **Backend**: Node.js, Express, TypeScript
- **Frontend**: React, Vite, Material-UI (MUI)
- **State Management**: Zustand
- **Container Integration**: Docker Registry HTTP API v2
- **File Processing**: tar-stream, gunzip-maybe
- **Diff Engine**: diff library

## Prerequisites

- **Node.js**: 18.x or higher
- **npm**: 9.x or higher
- **Disk Space**: Sufficient for image caching (configurable, default 10GB)

## Installation

### 1. Clone or Download

```bash
cd container-image-compare
```

### 2. Install Dependencies

```bash
npm run install-all
```

This will install dependencies for both backend and frontend.

### 3. Configure Environment

Create a `.env` file in the backend directory (or copy from `.env.example` if available):

```env
PORT=5000
NODE_ENV=development

# Cache Configuration
CACHE_DIR=./cache
MAX_CACHE_SIZE_GB=10

# Data Storage
DATA_DIR=./data
MAX_HISTORY_ITEMS=50

# Security - CHANGE THIS!
CREDENTIALS_ENCRYPTION_KEY=your-random-32-character-string-here
```

**Important**: Change `CREDENTIALS_ENCRYPTION_KEY` to a random 32-character string for security.

## Usage

### Development Mode

Run both backend and frontend in development mode with hot reload:

```bash
npm run dev
```

This starts:
- Backend API on `http://localhost:5000`
- Frontend dev server on `http://localhost:3000`

Open your browser to `http://localhost:3000`

### Production Build

Build the application for production:

```bash
npm run build
```

Start the production server:

```bash
npm start
```

The application will be available at `http://localhost:5000`

## Using the Application

### 1. Compare Images

On the home page, enter two container image references:

**Examples:**
```
nginx:1.25.0         vs  nginx:1.26.0
alpine:3.18          vs  alpine:3.19
docker.io/postgres:15 vs docker.io/postgres:16
ghcr.io/user/app:v1  vs ghcr.io/user/app:v2
```

Click **Compare Images** to start the comparison.

### 2. View Metadata Differences

The **Metadata** tab shows:
- User, working directory, entrypoint, CMD
- Environment variables (with status indicators)
- Labels and their values
- Exposed ports
- Architecture and OS

### 3. Explore Filesystem Differences

The **Filesystem** tab provides:
- Dual-pane file tree navigation
- Color-coded status indicators (added/removed/modified)
- Search functionality
- "Show only differences" filter
- Click files to view content comparison

### 4. Compare File Contents

Select a file in the filesystem view to see:
- Side-by-side content comparison
- Line-by-line diff highlighting
- Line numbers
- Search within files

### 5. Download Files

Use the download icon to export:
- Individual files
- Entire directories (as ZIP)
- Complete filesystem

### 6. View History

Access **History** to:
- See past comparisons
- Review previous results
- Delete old comparisons
- Re-open saved comparisons

### 7. Configure Settings

In **Settings**, customize:
- Cache directory location
- Maximum cache size (GB)
- History retention limit
- Display preferences
- Search behavior

## Authentication for Private Registries

### Adding Credentials

1. Go to **Settings**
2. Under **Registry Credentials**, click **Add Credential**
3. Enter:
   - Name (e.g., "Docker Hub Personal")
   - Registry (e.g., `docker.io`, `ghcr.io`)
   - Username
   - Password or Personal Access Token

4. Click **Save**

### Using Credentials

When comparing images from private registries:
1. Enter the image reference (e.g., `registry.example.com/private/image:tag`)
2. Select the appropriate credential from the dropdown
3. Click **Compare Images**

**Note**: If authentication fails, you'll see a clear error message indicating credential issues.

## Cache Management

The application caches downloaded images to speed up future comparisons and reduce bandwidth.

### Cache Location

Default: `./cache` (configurable in settings)

### Cache Size

- Default limit: 10 GB
- Automatically removes oldest images when limit reached (LRU eviction)
- Configurable in settings

### Viewing Cache Stats

Go to **Settings** → **Cache** section to see:
- Total cache size
- Number of cached images
- Option to clear cache

## Project Structure

```
container-image-compare/
├── backend/
│   ├── src/
│   │   ├── routes/         # API endpoints
│   │   ├── services/       # Business logic
│   │   │   ├── registryClient.ts    # Docker registry API
│   │   │   ├── imageCache.ts        # Image download & caching
│   │   │   ├── comparison.ts        # Diff engine
│   │   │   ├── history.ts           # Comparison history
│   │   │   └── settings.ts          # App settings
│   │   └── server.ts       # Express server
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   ├── src/
│   │   ├── components/     # React components
│   │   ├── pages/          # Page components
│   │   ├── store/          # State management
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── package.json
│   └── vite.config.ts
├── shared/
│   └── types.ts           # Shared TypeScript types
├── package.json
└── README.md
```

## API Endpoints

### Comparison
- `POST /api/comparison` - Create new comparison
- `GET /api/comparison/:id` - Get comparison by ID
- `POST /api/comparison/file-diff` - Get file content diff

### History
- `GET /api/history` - List all comparisons
- `DELETE /api/history/:id` - Delete comparison

### Settings
- `GET /api/settings` - Get current settings
- `PUT /api/settings` - Update settings

### Cache
- `GET /api/cache/stats` - Get cache statistics
- `POST /api/cache/clear` - Clear cache

### Download
- `POST /api/download` - Download file or directory

## Troubleshooting

### Port Already in Use

If port 5000 or 3000 is already in use:

1. Change the port in `.env` (backend) or `vite.config.ts` (frontend)
2. Restart the application

### Authentication Errors

If you see "Authentication failed" errors:

1. Verify registry URL is correct (e.g., `docker.io`, not `hub.docker.com`)
2. Check username and password/token
3. For Docker Hub, use a Personal Access Token instead of password
4. Ensure credentials are saved before comparing images

### Cache Issues

If images aren't caching or cache errors occur:

1. Check disk space availability
2. Verify cache directory permissions
3. Try clearing cache in Settings
4. Check `CACHE_DIR` path in `.env`

### Slow Comparisons

First comparison of large images can be slow due to download time:

1. Subsequent comparisons of cached images are much faster
2. Increase cache size limit to keep more images cached
3. Use smaller base images when possible

## Performance Tips

- **Cache Size**: Set appropriately for your usage (larger = fewer downloads)
- **History Limit**: Lower limits improve performance
- **Filter Views**: Use "show only differences" for large filesystems
- **Network**: Faster internet connection speeds up first comparison

## Cross-Platform Compatibility

This application runs on:
- ✅ **Windows** (PowerShell, CMD)
- ✅ **Linux** (bash, sh)
- ✅ **macOS** (bash, zsh)

### Platform-Specific Notes

**Windows:**
- Use PowerShell or Git Bash for best experience
- Ensure Node.js is in PATH

**Linux/macOS:**
- May need `sudo` for cache directory creation if using system paths
- Check file permissions on cache and data directories

## Development

### Running Tests

```bash
# Backend tests
cd backend
npm test

# Frontend tests
cd frontend
npm test
```

### Linting

```bash
# Backend
cd backend
npm run lint

# Frontend
cd frontend
npm run lint
```

### Building for Production

```bash
npm run build
```

This creates:
- `backend/dist/` - Compiled TypeScript
- `frontend/dist/` - Optimized React bundle

## Deployment

### Docker Compose (Local)

```bash
docker compose -f docker/docker-compose.yml up -d --build
# App available at http://localhost:5000
```

### Kubernetes (CI/CD with GitHub Actions)

Pushes to `main` automatically build a Docker image, push it to GHCR, and deploy to a K3s cluster via Helm. See [docs/github-actions-k8s.md](docs/github-actions-k8s.md) for cluster prerequisites and setup.

To deploy manually from a local machine with Docker and Helm:

```bash
helm\redeploy.bat
```

This builds the image locally, pushes to GHCR, and runs `helm upgrade`. Requires `docker login ghcr.io -u hankel-ai` beforehand.

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

MIT License - see LICENSE file for details

## Support

For issues, questions, or suggestions:
- Open an issue on GitHub
- Check existing issues for solutions

## Roadmap

Future enhancements:
- [ ] Real-time progress updates during image download
- [ ] Support for Docker compose file comparison
- [ ] Export comparison reports (PDF, HTML)
- [ ] Advanced filtering (by file type, size, etc.)
- [ ] Diff statistics and charts
- [ ] Support for OCI artifacts
- [ ] Multi-image comparison (>2 images)
- [ ] Integration with CI/CD pipelines
- [ ] WebSocket for live updates

## Acknowledgments

Built with:
- [Express](https://expressjs.com/)
- [React](https://react.dev/)
- [Material-UI](https://mui.com/)
- [Vite](https://vitejs.dev/)
- [tar-stream](https://github.com/mafintosh/tar-stream)
- [diff](https://github.com/kpdecker/jsdiff)

---

**Note**: This application downloads and caches container images locally. Ensure you have sufficient disk space and comply with image licensing terms.
