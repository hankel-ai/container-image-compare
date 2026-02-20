# Quick Start Guide

Get up and running with Container Image Compare in under 5 minutes!

## Prerequisites

- Node.js 18.x or higher
- npm 9.x or higher
- 10GB+ free disk space (for image caching)

## Option 1: Automated Setup (Recommended)

### Windows (PowerShell)
```powershell
.\setup.ps1
```

### Linux/macOS (Bash)
```bash
chmod +x setup.sh
./setup.sh
```

The setup script will:
1. Check prerequisites
2. Install all dependencies
3. Create default configuration
4. Optionally start the development server

## Option 2: Manual Setup

### Step 1: Install Dependencies
```bash
npm run install-all
```

### Step 2: Configure (Optional)
Create `backend/.env`:
```env
PORT=5000
CACHE_DIR=./cache
MAX_CACHE_SIZE_GB=10
CREDENTIALS_ENCRYPTION_KEY=your-random-32-char-string
```

### Step 3: Start Development Server
```bash
npm run dev
```

### Step 4: Open Browser
Navigate to: http://localhost:3000

## First Comparison

Try comparing these images to see the app in action:

**Example 1: Nginx versions**
- Left: `nginx:1.25.0`
- Right: `nginx:1.26.0`

**Example 2: Alpine Linux**
- Left: `alpine:3.18`
- Right: `alpine:3.19`

**Example 3: PostgreSQL**
- Left: `postgres:15`
- Right: `postgres:16`

## What to Expect

1. **First run**: Images will download (may take 30s-2min depending on size and network)
2. **Subsequent runs**: Cached images load instantly
3. **Comparison view**: See metadata and filesystem diffs side-by-side

## Common Issues

### Port Already in Use
If port 5000 or 3000 is taken:
- Edit `backend/.env` to change PORT
- Edit `frontend/vite.config.ts` to change dev server port

### Authentication Errors
For private registries:
1. Go to Settings
2. Add your registry credentials
3. Try comparison again

### Slow First Comparison
This is normal! Images are downloading. Cached comparisons are much faster.

## Production Build

For production deployment:

```bash
# Build
npm run build

# Start production server
npm start
```

Access at: http://localhost:5000

## Next Steps

- Read the full [README.md](README.md) for detailed documentation
- Explore the Settings page to customize behavior
- Review comparison history to see past results
- Set up credentials for private registries

## Need Help?

- Check the [README.md](README.md) troubleshooting section
- Review the PROCESSING.md for implementation details
- Open an issue on GitHub

---

**Tip**: Start with small public images (like alpine) to test the app before comparing large private images.
