# Troubleshooting Guide

Common issues and solutions for Container Image Compare.

## Installation Issues

### Problem: `npm install` fails with permission errors

**Windows:**
```powershell
# Run PowerShell as Administrator
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
npm run install-all
```

**Linux/macOS:**
```bash
# Don't use sudo with npm, instead fix permissions:
sudo chown -R $USER ~/.npm
npm run install-all
```

### Problem: Node.js not found or wrong version

**Check version:**
```bash
node --version  # Should be v18.x or higher
```

**Solution:**
- Download from https://nodejs.org/
- Or use nvm: `nvm install 18 && nvm use 18`

### Problem: TypeScript compilation errors

**Solution:**
```bash
# Clear caches and reinstall
cd backend
rm -rf node_modules package-lock.json
npm install

cd ../frontend
rm -rf node_modules package-lock.json
npm install
```

## Runtime Issues

### Problem: Port 5000 or 3000 already in use

**Find what's using the port (Windows):**
```powershell
netstat -ano | findstr :5000
# Kill process: taskkill /PID <pid> /F
```

**Find what's using the port (Linux/macOS):**
```bash
lsof -i :5000
# Kill process: kill -9 <pid>
```

**Change the port:**
- Backend: Edit `backend/.env` → `PORT=5001`
- Frontend: Edit `frontend/vite.config.ts` → `server: { port: 3001 }`

### Problem: "Cannot GET /" in production mode

**Cause:** Frontend not built yet

**Solution:**
```bash
npm run build
npm start
```

### Problem: Backend starts but frontend doesn't

**Check logs:**
```bash
npm run dev
# Look for errors in the output
```

**Common fixes:**
```bash
# Clear Vite cache
cd frontend
rm -rf node_modules/.vite

# Reinstall dependencies
npm install
```

## Comparison Issues

### Problem: "Authentication failed" error

**For Docker Hub:**
1. Don't use your Docker Hub password - use a Personal Access Token
2. Go to https://hub.docker.com/settings/security
3. Create new access token
4. Use token as password in app settings

**For GHCR (GitHub Container Registry):**
1. Create GitHub Personal Access Token
2. Give it `read:packages` scope
3. Registry: `ghcr.io`
4. Username: Your GitHub username
5. Password: Your token

**For private registries:**
- Verify registry URL (e.g., `registry.company.com`, not `https://...`)
- Check username/password are correct
- Ensure you have pull permissions

### Problem: Comparison takes forever (>5 minutes)

**Causes:**
- Large image size
- Slow network
- First-time download

**Solutions:**
- Check network connection
- Try a smaller image first to verify app works
- Check available disk space
- Monitor cache size in settings

**Progress indication:**
```bash
# Backend logs show download progress
[2025-12-06] Fetching image manifest...
[2025-12-06] Downloading layer 1/5...
[2025-12-06] Downloading layer 2/5...
```

### Problem: "Image not found" error

**Check image name format:**
```
✅ nginx:1.25.0
✅ docker.io/library/nginx:1.25.0
✅ ghcr.io/user/repo:tag
✅ registry.company.com/project/image:v1

❌ nginx (missing tag)
❌ http://docker.io/nginx:1.25.0 (don't include protocol)
❌ nginx:latest:version (only one tag)
```

**Verify image exists:**
```bash
# Check if image exists in registry
docker pull nginx:1.25.0
# If docker pull fails, the image doesn't exist or needs auth
```

### Problem: Some files show as binary but they're not

**Cause:** Binary detection heuristic is conservative

**Workaround:**
- File will still appear in tree
- Download the file to view locally
- Future enhancement: Better binary detection

### Problem: Comparison completes but shows no differences

**Possible causes:**
1. Images are actually identical
2. Same image compared to itself
3. Tag points to same digest

**Verify:**
```bash
# Compare manifests
docker manifest inspect nginx:1.25.0
docker manifest inspect nginx:1.26.0
# Check if digests match
```

## Cache Issues

### Problem: Cache directory fills up disk

**Check cache size:**
- Go to Settings → Cache section
- View current cache size

**Solutions:**
1. Reduce max cache size in Settings
2. Clear cache (Settings → Clear Cache button)
3. Manually delete cache folder:
   ```bash
   rm -rf backend/cache/*
   ```

### Problem: Cached image is corrupted

**Symptoms:**
- Comparison fails after first success
- Error reading file content

**Solution:**
```bash
# Clear entire cache
rm -rf backend/cache
# Or delete specific image cache
rm -rf backend/cache/<hash>
```

### Problem: Cache location not writable

**Error:** `EACCES: permission denied`

**Solution:**
```bash
# Linux/macOS
chmod -R 755 backend/cache

# Or change cache location in .env
CACHE_DIR=/tmp/container-compare-cache
```

## UI Issues

### Problem: File tree doesn't expand

**Cause:** Too many files, React rendering issue

**Solutions:**
- Use search to filter
- Enable "Show only differences"
- Try refreshing the page

### Problem: Diff view shows garbled text

**Cause:** File encoding not UTF-8

**Workaround:**
- Download file to view locally
- File may be binary despite heuristic

### Problem: Scrolling doesn't sync between panes

**Cause:** Feature not yet implemented for all scroll types

**Workaround:**
- Use keyboard navigation
- Select files instead of scrolling

### Problem: Search doesn't find known file

**Check:**
- Search is case-insensitive by default (can change in settings)
- Search looks in file paths, not content
- Try partial name (e.g., "nginx" not "nginx.conf")

## Network Issues

### Problem: Proxy/firewall blocks registry access

**Error:** `ECONNREFUSED`, `ETIMEDOUT`

**Solution:**
Configure proxy in `.env`:
```env
HTTP_PROXY=http://proxy.company.com:8080
HTTPS_PROXY=http://proxy.company.com:8080
NO_PROXY=localhost,127.0.0.1
```

### Problem: SSL/TLS certificate errors

**Error:** `CERT_UNTRUSTED`, `UNABLE_TO_VERIFY_LEAF_SIGNATURE`

**For self-signed certificates:**
```env
# NOT RECOMMENDED FOR PRODUCTION
NODE_TLS_REJECT_UNAUTHORIZED=0
```

**Better solution:**
- Add CA certificate to system trust store
- Or use registry that has valid cert

## Performance Issues

### Problem: App is slow/laggy

**Check:**
1. How many images in cache? (Settings → Cache)
2. How many history items? (History page)
3. Browser DevTools → Performance tab

**Solutions:**
1. Clear old history items
2. Reduce cache size
3. Close other browser tabs
4. Use production build (faster than dev):
   ```bash
   npm run build
   npm start
   ```

### Problem: High memory usage

**Cause:** Large images with many files

**Solutions:**
- Use "Show only differences" filter
- Clear cache periodically
- Increase system RAM
- Compare smaller images

## Data Issues

### Problem: Lost comparison history

**Cause:** Deleted `backend/data/history/` folder

**Prevention:**
- Backup `backend/data/` folder periodically
- Or export important comparisons as JSON

### Problem: Settings reset to defaults

**Cause:** Deleted or corrupted `backend/data/settings.json`

**Solution:**
- Settings will auto-recreate with defaults
- Reconfigure your preferences

### Problem: Saved credentials don't work

**Cause:** Changed `CREDENTIALS_ENCRYPTION_KEY` in `.env`

**Solution:**
- If you changed the key, old credentials are unreadable
- Delete `backend/data/credentials.json`
- Re-add all credentials

## Development Issues

### Problem: Hot reload not working

**Backend:**
```bash
# Check ts-node-dev is running
cd backend
npm run dev
# Should show: "Watching for file changes..."
```

**Frontend:**
```bash
# Check Vite dev server
cd frontend
npm run dev
# Should show: "VITE v5.x.x  ready in XXX ms"
```

### Problem: TypeScript errors in IDE but builds fine

**Solution:**
```bash
# Restart TypeScript server in VS Code
# Cmd+Shift+P → "TypeScript: Restart TS Server"

# Or rebuild TypeScript
npm run build
```

### Problem: ESLint errors everywhere

**Solution:**
```bash
# Auto-fix what can be fixed
cd frontend
npm run lint -- --fix

cd ../backend
npm run lint -- --fix
```

## Getting Help

### Still having issues?

1. **Check logs:**
   - Backend: Terminal running `npm run dev`
   - Frontend: Browser DevTools Console (F12)

2. **Enable debug mode:**
   ```env
   NODE_ENV=development
   DEBUG=*
   ```

3. **Minimal reproduction:**
   - Try with simple public image (alpine:3.18)
   - If that works, issue is with specific image

4. **Check versions:**
   ```bash
   node --version
   npm --version
   ```

5. **Fresh install:**
   ```bash
   rm -rf node_modules backend/node_modules frontend/node_modules
   rm package-lock.json backend/package-lock.json frontend/package-lock.json
   npm run install-all
   ```

### Report a bug

Include:
- Operating system
- Node.js version
- Error message (full stack trace)
- Steps to reproduce
- What you expected to happen

### Common error patterns

| Error Message | Likely Cause | Solution |
|---------------|-------------|----------|
| `EACCES` | Permission denied | Check file/folder permissions |
| `ENOENT` | File not found | Create missing directories |
| `EADDRINUSE` | Port in use | Change port or kill process |
| `MODULE_NOT_FOUND` | Missing dependency | Run `npm install` |
| `401 Unauthorized` | Bad credentials | Check registry auth |
| `404 Not Found` | Image doesn't exist | Verify image name |
| `ETIMEDOUT` | Network issue | Check connection/proxy |

## Best Practices to Avoid Issues

1. **Start small:** Test with small public images first
2. **Update regularly:** Keep Node.js and npm updated
3. **Clean cache:** Periodically clear old cached images
4. **Backup data:** Save `backend/data/` folder
5. **Monitor disk:** Ensure sufficient space for cache
6. **Use production build:** For better performance
7. **Read logs:** They often explain what's wrong
8. **Test auth:** Verify credentials with `docker login` first

## Quick Health Check

Run these to verify everything is working:

```bash
# 1. Check Node.js
node --version  # Should be v18+

# 2. Check dependencies
cd container-image-compare
npm run install-all  # Should complete without errors

# 3. Start dev server
npm run dev  # Should start both backend and frontend

# 4. Open browser
# http://localhost:3000 should load

# 5. Try comparison
# Compare: alpine:3.18 vs alpine:3.19
# Should complete in <30 seconds
```

If all these work, your installation is healthy! 🎉
