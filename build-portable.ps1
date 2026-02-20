# Container Image Compare - Portable Build Script
# Creates a self-contained portable distribution with bundled Node.js

param(
    [string]$OutputDir = ".\dist\portable",
    [string]$NodeVersion = "20.18.1"
)

Write-Host "🚀 Container Image Compare - Portable Build" -ForegroundColor Cyan
Write-Host "============================================`n" -ForegroundColor Cyan

# Check Node.js installation (for building)
Write-Host "📋 Checking prerequisites..." -ForegroundColor Yellow
try {
    $installedNodeVersion = node --version
    Write-Host "✓ Node.js found: $installedNodeVersion" -ForegroundColor Green
} catch {
    Write-Host "✗ Node.js not found. Please install Node.js 18.x or higher." -ForegroundColor Red
    exit 1
}

# Clean and create output directory
Write-Host "`n📦 Preparing output directory..." -ForegroundColor Yellow
if (Test-Path $OutputDir) {
    Remove-Item -Path $OutputDir -Recurse -Force
}
New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
New-Item -ItemType Directory -Path "$OutputDir\app" -Force | Out-Null
New-Item -ItemType Directory -Path "$OutputDir\node" -Force | Out-Null

# Download Node.js standalone binary
Write-Host "`n📥 Downloading Node.js $NodeVersion standalone binary..." -ForegroundColor Yellow
$nodeZipUrl = "https://nodejs.org/dist/v$NodeVersion/node-v$NodeVersion-win-x64.zip"
$nodeZipPath = "$OutputDir\node-download.zip"
$nodeExtractPath = "$OutputDir\node-extract"

try {
    # Download with progress
    $ProgressPreference = 'SilentlyContinue'  # Speeds up Invoke-WebRequest
    Invoke-WebRequest -Uri $nodeZipUrl -OutFile $nodeZipPath -UseBasicParsing
    Write-Host "✓ Downloaded Node.js binary" -ForegroundColor Green
    
    # Extract
    Write-Host "📦 Extracting Node.js..." -ForegroundColor Yellow
    Expand-Archive -Path $nodeZipPath -DestinationPath $nodeExtractPath -Force
    
    # Copy node.exe and npm to the node folder
    $nodeSourceDir = Get-ChildItem -Path $nodeExtractPath -Directory | Select-Object -First 1
    Copy-Item -Path "$($nodeSourceDir.FullName)\node.exe" -Destination "$OutputDir\node\"
    Copy-Item -Path "$($nodeSourceDir.FullName)\npm" -Destination "$OutputDir\node\" -ErrorAction SilentlyContinue
    Copy-Item -Path "$($nodeSourceDir.FullName)\npm.cmd" -Destination "$OutputDir\node\"
    Copy-Item -Path "$($nodeSourceDir.FullName)\npx" -Destination "$OutputDir\node\" -ErrorAction SilentlyContinue
    Copy-Item -Path "$($nodeSourceDir.FullName)\npx.cmd" -Destination "$OutputDir\node\"
    Copy-Item -Path "$($nodeSourceDir.FullName)\node_modules" -Destination "$OutputDir\node\node_modules" -Recurse
    
    # Cleanup download files
    Remove-Item -Path $nodeZipPath -Force
    Remove-Item -Path $nodeExtractPath -Recurse -Force
    
    Write-Host "✓ Node.js bundled successfully" -ForegroundColor Green
} catch {
    Write-Host "✗ Failed to download/extract Node.js: $_" -ForegroundColor Red
    Write-Host "  You can manually download from: $nodeZipUrl" -ForegroundColor Yellow
    exit 1
}

# Install dependencies if needed
if (-not (Test-Path ".\node_modules") -or -not (Test-Path ".\backend\node_modules") -or -not (Test-Path ".\frontend\node_modules")) {
    Write-Host "`n📦 Installing dependencies..." -ForegroundColor Yellow
    npm run install-all
    if ($LASTEXITCODE -ne 0) {
        Write-Host "✗ Failed to install dependencies" -ForegroundColor Red
        exit 1
    }
}

# Build the frontend
Write-Host "`n🔨 Building frontend..." -ForegroundColor Yellow
Push-Location frontend
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "✗ Frontend build failed" -ForegroundColor Red
    Pop-Location
    exit 1
}
Pop-Location

# Build the backend
Write-Host "`n🔨 Building backend..." -ForegroundColor Yellow
Push-Location backend
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "✗ Backend build failed" -ForegroundColor Red
    Pop-Location
    exit 1
}
Pop-Location

# Copy required files
Write-Host "`n📁 Copying application files..." -ForegroundColor Yellow

# Copy backend - note: tsc outputs to dist/backend/src due to rootDir: ".."
Copy-Item -Path ".\backend\dist" -Destination "$OutputDir\app\backend\dist" -Recurse
Copy-Item -Path ".\backend\package.json" -Destination "$OutputDir\app\backend\"
Copy-Item -Path ".\backend\package-lock.json" -Destination "$OutputDir\app\backend\" -ErrorAction SilentlyContinue

# Copy frontend build
Copy-Item -Path ".\frontend\dist" -Destination "$OutputDir\app\frontend\dist" -Recurse

# Copy shared types
New-Item -ItemType Directory -Path "$OutputDir\app\shared" -Force | Out-Null
Copy-Item -Path ".\shared\types.ts" -Destination "$OutputDir\app\shared\"
Copy-Item -Path ".\shared\types.js" -Destination "$OutputDir\app\shared\" -ErrorAction SilentlyContinue
Copy-Item -Path ".\shared\types.d.ts" -Destination "$OutputDir\app\shared\" -ErrorAction SilentlyContinue

# Copy root package.json (for metadata)
Copy-Item -Path ".\package.json" -Destination "$OutputDir\app\"

# Copy launcher script
Write-Host "`n📝 Copying launcher script..." -ForegroundColor Yellow
Copy-Item -Path ".\portable-launcher.ps1" -Destination "$OutputDir\start.ps1"

# Create batch file launcher for easy double-click
$batchLauncher = @'
@echo off
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -File "start.ps1" %*
'@

$batchLauncher | Set-Content "$OutputDir\Container-Image-Compare.bat" -Encoding ASCII

# Create README for portable version
$readmeContent = @'
# Container Image Compare - Portable Version

## Quick Start
1. Double-click `Container-Image-Compare.bat` (or run `start.ps1` in PowerShell)
2. On first run, you'll be asked to configure the port (optional)
3. The app will automatically open in your default browser

## Requirements
- Windows 10/11 (64-bit)
- No additional software required - Node.js is bundled!

## Files and Folders
- `Container-Image-Compare.bat` - Main launcher (double-click to run)
- `start.ps1` - PowerShell launcher script
- `app/` - Application files (do not modify)
- `node/` - Bundled Node.js runtime
- `data/` - Your data (created on first run)
  - `data/appdata/` - Settings, cache, and history

## Configuration
Port settings can be changed:
1. In the app's Settings page (requires restart)
2. By running: `start.ps1 -Setup` to reconfigure

## Troubleshooting
- If the app doesn't start, check `data/appdata/logs/` for error logs
- Try running `start.ps1 -Setup` to reconfigure
- Ensure Windows Defender or antivirus isn't blocking the bundled node.exe
'@

$readmeContent | Set-Content "$OutputDir\README.txt" -Encoding UTF8

# Create zip file for distribution
Write-Host "`n📦 Creating distribution zip file..." -ForegroundColor Yellow
$zipFileName = "Container-Image-Compare-Portable.zip"
$zipPath = ".\dist\$zipFileName"

# Remove existing zip if present
if (Test-Path $zipPath) {
    Remove-Item -Path $zipPath -Force
}

# Create the zip file
try {
    Compress-Archive -Path "$OutputDir\*" -DestinationPath $zipPath -Force
    $zipSize = [math]::Round((Get-Item $zipPath).Length / 1MB, 2)
    Write-Host "✓ Created $zipPath ($zipSize MB)" -ForegroundColor Green
} catch {
    Write-Host "⚠ Failed to create zip file: $_" -ForegroundColor Yellow
    Write-Host "  You can manually zip the contents of '$OutputDir'" -ForegroundColor Gray
}

Write-Host "`n✅ Portable build complete!" -ForegroundColor Green
Write-Host "`nOutput directory: $OutputDir" -ForegroundColor Cyan
Write-Host "Distribution zip: $zipPath" -ForegroundColor Cyan
Write-Host "`nTo distribute:" -ForegroundColor Yellow
Write-Host "  1. Share the '$zipFileName' file" -ForegroundColor Gray
Write-Host "  2. Recipients extract and run Container-Image-Compare.bat" -ForegroundColor Gray
Write-Host ""
