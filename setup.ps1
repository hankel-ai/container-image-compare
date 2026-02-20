# Container Image Compare - Quick Start Script

param(
    [switch]$Portable,
    [switch]$Production,
    [switch]$Help
)

# Always run from the script's directory
Set-Location $PSScriptRoot

# Show help/menu if no action specified
if ($Help -or ($args.Count -eq 0 -and -not $Portable -and -not $Production)) {
    Write-Host "`n🚀 Container Image Compare - Setup Script" -ForegroundColor Cyan
    Write-Host "==========================================" -ForegroundColor Cyan
    Write-Host "`nUsage:" -ForegroundColor Yellow
    Write-Host "  .\setup.ps1             - Install dependencies and start dev server" -ForegroundColor Gray
    Write-Host "  .\setup.ps1 -Production - Build and run in production mode" -ForegroundColor Gray
    Write-Host "  .\setup.ps1 -Portable   - Build portable distribution" -ForegroundColor Gray
    Write-Host "  .\setup.ps1 -Help       - Show this help message" -ForegroundColor Gray
    Write-Host ""
    
    if ($Help) { exit 0 }
    
    # If no args, show menu and default to dev mode
    Write-Host "Options:" -ForegroundColor Yellow
    Write-Host "  [1] Start development server (default)" -ForegroundColor White
    Write-Host "  [2] Build and run production mode" -ForegroundColor White
    Write-Host "  [3] Build portable distribution" -ForegroundColor White
    Write-Host ""
    $choice = Read-Host "Select option (1-3, or press Enter for 1)"
    
    if ($choice -eq "2") {
        $Production = $true
    } elseif ($choice -eq "3") {
        $Portable = $true
    }
}

# Handle portable build
if ($Portable) {
    Write-Host "`n📦 Building portable distribution..." -ForegroundColor Cyan
    & "$PSScriptRoot\build-portable.ps1"
    exit $LASTEXITCODE
}

# Handle production mode
if ($Production) {
    # Save original directory and NODE_ENV for restoration on exit
    $originalDir = Get-Location
    $originalNodeEnv = $env:NODE_ENV
    
    try {
        Write-Host "🚀 Container Image Compare - Production Mode" -ForegroundColor Cyan
        Write-Host "=============================================`n" -ForegroundColor Cyan
        
        # Check Node.js installation
        Write-Host "📋 Checking prerequisites..." -ForegroundColor Yellow
        try {
            $nodeVersion = node --version
            Write-Host "✓ Node.js found: $nodeVersion" -ForegroundColor Green
        } catch {
            Write-Host "✗ Node.js not found. Please install Node.js 18.x or higher." -ForegroundColor Red
            Write-Host "  Download from: https://nodejs.org/" -ForegroundColor Yellow
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
        } else {
            Write-Host "✓ Dependencies already installed" -ForegroundColor Green
        }
        
        # Build frontend
        Write-Host "`n🔨 Building frontend..." -ForegroundColor Yellow
        Push-Location frontend
        npm run build
        $buildResult = $LASTEXITCODE
        Pop-Location
        if ($buildResult -ne 0) {
            Write-Host "✗ Frontend build failed" -ForegroundColor Red
            exit 1
        }
        Write-Host "✓ Frontend built successfully" -ForegroundColor Green
        
        # Build backend
        Write-Host "`n🔨 Building backend..." -ForegroundColor Yellow
        Push-Location backend
        npm run build
        $buildResult = $LASTEXITCODE
        Pop-Location
        if ($buildResult -ne 0) {
            Write-Host "✗ Backend build failed" -ForegroundColor Red
            exit 1
        }
        Write-Host "✓ Backend built successfully" -ForegroundColor Green
        
        # Start production server
        Write-Host "`n🚀 Starting production server..." -ForegroundColor Cyan
        Write-Host "   Access the application at http://localhost:5000`n" -ForegroundColor Yellow
        
        # Set production environment and start (run from backend dir)
        $env:NODE_ENV = "production"
        Push-Location backend
        npm start
        $exitCode = $LASTEXITCODE
        Pop-Location
    }
    finally {
        # Restore original directory and NODE_ENV
        Set-Location $originalDir
        if ($null -eq $originalNodeEnv) {
            Remove-Item Env:NODE_ENV -ErrorAction SilentlyContinue
        } else {
            $env:NODE_ENV = $originalNodeEnv
        }
    }
    exit $exitCode
}

# Default: Development mode
Write-Host "🚀 Container Image Compare - Setup Script" -ForegroundColor Cyan
Write-Host "==========================================`n" -ForegroundColor Cyan

# Check Node.js installation
Write-Host "📋 Checking prerequisites..." -ForegroundColor Yellow
try {
    $nodeVersion = node --version
    Write-Host "✓ Node.js found: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "✗ Node.js not found. Please install Node.js 18.x or higher." -ForegroundColor Red
    Write-Host "  Download from: https://nodejs.org/" -ForegroundColor Yellow
    exit 1
}

try {
    $npmVersion = npm --version
    Write-Host "✓ npm found: v$npmVersion" -ForegroundColor Green
} catch {
    Write-Host "✗ npm not found." -ForegroundColor Red
    exit 1
}

Write-Host "`n📦 Installing dependencies..." -ForegroundColor Yellow
Write-Host "This may take a few minutes...`n" -ForegroundColor Gray

# Install dependencies
try {
    npm run install-all
    if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
    Write-Host "`n✓ Dependencies installed successfully!`n" -ForegroundColor Green
} catch {
    Write-Host "✗ Failed to install dependencies" -ForegroundColor Red
    exit 1
}

# Check for .env file
Write-Host "⚙️  Checking configuration..." -ForegroundColor Yellow
$envPath = "backend\.env"
if (-not (Test-Path $envPath)) {
    Write-Host "⚠️  No .env file found. Creating default configuration..." -ForegroundColor Yellow
    
    $randomKey = -join ((65..90) + (97..122) + (48..57) | Get-Random -Count 32 | ForEach-Object {[char]$_})
    
    $envContent = @"
# Server Configuration
PORT=3000
NODE_ENV=development

# Cache Configuration
CACHE_DIR=./cache
MAX_CACHE_SIZE_GB=10

# Data Storage
DATA_DIR=./data
MAX_HISTORY_ITEMS=50

# Security - AUTO-GENERATED
CREDENTIALS_ENCRYPTION_KEY=$randomKey
"@
    
    $envContent | Out-File -FilePath $envPath -Encoding utf8
    Write-Host "✓ Created .env file with auto-generated encryption key" -ForegroundColor Green
} else {
    Write-Host "✓ Configuration file exists" -ForegroundColor Green
}

Write-Host "`n✅ Setup complete!`n" -ForegroundColor Green

Write-Host "🎯 Next steps:" -ForegroundColor Cyan
Write-Host "  1. Start development server: " -NoNewline
Write-Host "npm run dev" -ForegroundColor Yellow
Write-Host "  2. Open browser: " -NoNewline
Write-Host "http://localhost:5000" -ForegroundColor Yellow
Write-Host "  3. Try comparing: " -NoNewline
Write-Host "nginx:1.25.0 vs nginx:1.26.0`n" -ForegroundColor Yellow

Write-Host "📚 For more information, see README.md`n" -ForegroundColor Gray

Write-Host "`n🚀 Starting development server...`n" -ForegroundColor Cyan
npm run dev
