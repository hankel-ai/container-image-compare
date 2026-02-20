# Clean Installation Guide

This document explains how to reset the Container Image Compare application to a clean state, suitable for sharing or redistribution.

## Application Data Structure

All application data is stored in a single `appdata/` folder within the backend directory:

```
backend/
├── appdata/                 # ← ALL user data lives here
│   ├── settings.json       # Application settings and encrypted credentials
│   ├── cache/              # Downloaded image layers and filesystem tars
│   │   └── <hash>/         # Each cached image gets its own folder
│   │       ├── filesystem.tar
│   │       └── config.json
│   ├── history/            # Comparison result history files
│   │   └── <uuid>.json     # Each comparison saved as JSON
│   └── logs/               # Application log files
│       └── app-YYYY-MM-DD.log
```

## Creating a Clean Distribution

To prepare the application for distribution without any user data:

### Option 1: Delete appdata folder (Recommended)

```bash
# From the project root
rm -rf backend/appdata/
```

Or on Windows PowerShell:
```powershell
Remove-Item -Recurse -Force backend/appdata/
```

### Option 2: Use the provided cleanup script

```bash
# From the project root
npm run clean-userdata
```

## What Gets Removed

When you delete `appdata/`:

| Data Type | Location | Description |
|-----------|----------|-------------|
| Settings | `appdata/settings.json` | Theme, cache limits, display preferences |
| Credentials | `appdata/settings.json` | Encrypted registry credentials |
| Cache | `appdata/cache/` | Downloaded container image layers |
| History | `appdata/history/` | Saved comparison results |
| Logs | `appdata/logs/` | Application debug logs |

## Default Settings

When started fresh (no `appdata/` folder), the application uses these defaults:

```json
{
  "maxCacheSizeGB": 20,
  "maxHistoryItems": 20,
  "theme": "auto",
  "showOnlyDifferences": false,
  "caseSensitiveSearch": false,
  "debugLogging": false
}
```

## First-Time Setup

After a clean installation:

1. **Start the application**
   ```bash
   cd backend && npm run dev
   # In another terminal
   cd frontend && npm run dev
   ```

2. **Configure credentials** (if needed)
   - Navigate to Settings page
   - Add registry credentials for private registries
   - Credentials are encrypted when a `CIC_CRED_KEY` environment variable is set

3. **Adjust settings**
   - Set max cache size (default 20GB)
   - Set max history items (default 20)
   - Enable debug logging if troubleshooting

## Legacy Data Migration

If upgrading from an older version with separate cache folders:

The old data locations were:
- `backend/.cache/images/` - Old image cache
- `backend/data/` - Old settings and history
- `backend/cache/` - Unused legacy folder

To migrate:
1. Back up any important comparison history from `backend/data/history/`
2. Delete all old folders
3. Start fresh with the new `appdata/` structure

## Environment Variables

The following environment variables can override default paths:

| Variable | Description | Default |
|----------|-------------|---------|
| `APP_DATA_DIR` | Base directory for all app data | `./appdata` |
| `MAX_CACHE_SIZE_GB` | Maximum cache size in GB | `20` |
| `MAX_HISTORY_ITEMS` | Maximum saved comparisons | `20` |
| `CIC_CRED_KEY` | Encryption key for credentials | (none - plaintext) |

## Distributing the Application

To create a clean zip file for distribution:

```bash
# 1. Remove user data
rm -rf backend/appdata/

# 2. Remove node_modules (will be reinstalled)
rm -rf node_modules/ backend/node_modules/ frontend/node_modules/

# 3. Remove build artifacts
rm -rf backend/dist/ frontend/dist/

# 4. Create archive
zip -r container-image-compare.zip . \
  -x "*.git*" \
  -x "*node_modules*" \
  -x "*appdata*" \
  -x "*.env*"
```

Recipients can then:
```bash
unzip container-image-compare.zip
cd container-image-compare
npm run setup  # Install all dependencies
npm run dev    # Start development servers
```
