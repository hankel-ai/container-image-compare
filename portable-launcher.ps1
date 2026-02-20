# Container Image Compare - Portable Launcher
# This script initializes and runs the portable application

param(
    [switch]$Setup,
    [switch]$Silent
)

# Set console title
$Host.UI.RawUI.WindowTitle = "Container Image Compare"

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppDir = Join-Path $ScriptDir "app"
$DataDir = Join-Path $ScriptDir "data"
$NodeDir = Join-Path $ScriptDir "node"
$SettingsFile = Join-Path $DataDir "appdata\settings.json"
$FirstRunFile = Join-Path $DataDir ".first-run-complete"

# Use bundled Node.js if available
$BundledNode = Join-Path $NodeDir "node.exe"
$BundledNpm = Join-Path $NodeDir "npm.cmd"
$BundledNpx = Join-Path $NodeDir "npx.cmd"

if (Test-Path $BundledNode) {
    $NodeExe = $BundledNode
    $NpmCmd = $BundledNpm
    $NpxCmd = $BundledNpx
    # Add bundled node to PATH for child processes
    $env:PATH = "$NodeDir;$env:PATH"
} else {
    $NodeExe = "node"
    $NpmCmd = "npm"
    $NpxCmd = "npx"
}

function Write-Status {
    param($message, $color = "White")
    if (-not $Silent) {
        Write-Host $message -ForegroundColor $color
    }
}

# Check for Node.js (bundled or system)
try {
    $nodeVersion = & $NodeExe --version 2>$null
    if (-not $nodeVersion) { throw "Node not found" }
    $nodeSource = if (Test-Path $BundledNode) { "bundled" } else { "system" }
    Write-Status "Node.js found: $nodeVersion ($nodeSource)" "Green"
}
catch {
    Write-Host "Node.js is required but not found." -ForegroundColor Red
    Write-Host "The bundled Node.js may be missing or corrupted." -ForegroundColor Yellow
    Write-Host "Please reinstall the portable package or install Node.js from: https://nodejs.org/" -ForegroundColor Yellow
    if (-not $Silent) { Read-Host "Press Enter to exit" }
    exit 1
}

# Initialize data directory
if (-not (Test-Path $DataDir)) {
    New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
}

# Check if first run
$isFirstRun = -not (Test-Path $FirstRunFile)

# Default settings
$frontendPort = 5000
$httpProxy = ""
$noProxy = ""

# Helper function to load settings from file
function Get-SettingsFromFile {
    if (Test-Path $SettingsFile) {
        try {
            $content = Get-Content $SettingsFile -Raw | ConvertFrom-Json
            return $content
        }
        catch {
            return $null
        }
    }
    return $null
}

# Helper function to save settings to file (UTF-8 without BOM for JSON compatibility)
function Save-SettingsToFile {
    param($settingsObj)
    $appdataDir = Join-Path $DataDir "appdata"
    if (-not (Test-Path $appdataDir)) {
        New-Item -ItemType Directory -Path $appdataDir -Force | Out-Null
    }
    $json = $settingsObj | ConvertTo-Json -Depth 10
    # Write UTF-8 without BOM (required for JSON compatibility)
    [System.IO.File]::WriteAllText($SettingsFile, $json, [System.Text.UTF8Encoding]::new($false))
}

# Load existing settings if available
$existingSettings = Get-SettingsFromFile
if ($existingSettings -and $existingSettings.settings) {
    if ($existingSettings.settings.frontendPort) {
        $frontendPort = $existingSettings.settings.frontendPort
    }
    if ($existingSettings.settings.httpProxy) {
        $httpProxy = $existingSettings.settings.httpProxy
    }
    if ($existingSettings.settings.noProxy) {
        $noProxy = $existingSettings.settings.noProxy
    }
}

if ($isFirstRun -or $Setup) {
    Write-Host ""
    Write-Host "Container Image Compare - First Run Setup" -ForegroundColor Cyan
    Write-Host "=========================================" -ForegroundColor Cyan
    Write-Host ""
    
    Write-Host "This portable version will store all data in:" -ForegroundColor Yellow
    Write-Host "  $DataDir" -ForegroundColor Gray
    Write-Host ""
    
    # Ask about proxy configuration first (needed for npm install)
    $proxyChanged = $false
    $noProxyChanged = $false
    $configProxy = Read-Host "Do you need to use an HTTP proxy? (y/N)"
    if ($configProxy -eq "y" -or $configProxy -eq "Y") {
        $inputProxy = Read-Host "HTTP Proxy URL (e.g., http://proxy:8080)"
        if ($inputProxy) { 
            $httpProxy = $inputProxy
            $proxyChanged = $true
            Write-Host "Proxy configured: $httpProxy" -ForegroundColor Green
        }
        
        $inputNoProxy = Read-Host "Hosts to bypass proxy (comma-separated, e.g., localhost,192.168.1.0/24,.internal.local)"
        if ($inputNoProxy) {
            $noProxy = $inputNoProxy
            $noProxyChanged = $true
            Write-Host "No-proxy hosts: $noProxy" -ForegroundColor Green
        }
    }
    Write-Host ""
    
    # Ask about port configuration
    $portChanged = $false
    $configPorts = Read-Host "Would you like to configure a custom port? (y/N)"
    if ($configPorts -eq "y" -or $configPorts -eq "Y") {
        $inputPort = Read-Host "Browser access port (default: 5000)"
        if ($inputPort) { 
            $frontendPort = [int]$inputPort
            $portChanged = $true
        }
        
        Write-Host ""
        Write-Host "Port configured: $frontendPort" -ForegroundColor Green
    }
    
    # Create appdata directory and cache directory
    $appdataDir = Join-Path $DataDir "appdata"
    New-Item -ItemType Directory -Path $appdataDir -Force | Out-Null
    $cacheDir = Join-Path $appdataDir "cache"
    New-Item -ItemType Directory -Path $cacheDir -Force | Out-Null
    
    # Build settings object - either update existing or create new
    if ($existingSettings) {
        # Update existing settings with new values
        if ($portChanged) {
            $existingSettings.settings.frontendPort = $frontendPort
        }
        if ($proxyChanged) {
            # Add or update httpProxy property
            if (-not ($existingSettings.settings | Get-Member -Name "httpProxy" -MemberType NoteProperty)) {
                $existingSettings.settings | Add-Member -NotePropertyName "httpProxy" -NotePropertyValue $httpProxy
            } else {
                $existingSettings.settings.httpProxy = $httpProxy
            }
        }
        if ($noProxyChanged) {
            # Add or update noProxy property
            if (-not ($existingSettings.settings | Get-Member -Name "noProxy" -MemberType NoteProperty)) {
                $existingSettings.settings | Add-Member -NotePropertyName "noProxy" -NotePropertyValue $noProxy
            } else {
                $existingSettings.settings.noProxy = $noProxy
            }
        }
        Save-SettingsToFile $existingSettings
        Write-Host "Settings updated" -ForegroundColor Green
    } else {
        # Create new settings file
        $settingsObj = @{
            settings = @{
                cacheDir = $cacheDir
                maxCacheSizeGB = 20
                maxHistoryItems = 20
                theme = "auto"
                showOnlyDifferences = $false
                caseSensitiveSearch = $false
                debugLogging = $false
                frontendPort = $frontendPort
                skipTlsVerify = $true
                httpProxy = $httpProxy
                noProxy = $noProxy
                insecureRegistries = @()
            }
            credentials = @()
        }
        Save-SettingsToFile $settingsObj
        Write-Host "Settings created" -ForegroundColor Green
    }
    
    # Set proxy environment variables for npm install if configured
    if ($httpProxy) {
        Write-Host "Setting proxy for npm install: $httpProxy" -ForegroundColor Yellow
        $env:HTTP_PROXY = $httpProxy
        $env:HTTPS_PROXY = $httpProxy
        $env:npm_config_proxy = $httpProxy
        $env:npm_config_https_proxy = $httpProxy
    }
    
    # Install backend dependencies
    Write-Host ""
    Write-Host "Installing backend dependencies (first run only)..." -ForegroundColor Yellow
    Write-Host "This may take a few minutes..." -ForegroundColor Gray
    Push-Location (Join-Path $AppDir "backend")
    
    # Run npm install and show output (reset window title afterward)
    $npmProcess = Start-Process -FilePath $NpmCmd -ArgumentList "install", "--production" -WorkingDirectory (Get-Location) -NoNewWindow -Wait -PassThru
    $Host.UI.RawUI.WindowTitle = "Container Image Compare"
    
    if ($npmProcess.ExitCode -ne 0) {
        Write-Host "Failed to install dependencies (exit code: $($npmProcess.ExitCode))" -ForegroundColor Red
        Write-Host "Try running manually: cd `"$(Get-Location)`" && npm install --production" -ForegroundColor Yellow
        Pop-Location
        if (-not $Silent) { Read-Host "Press Enter to exit" }
        exit 1
    }
    Pop-Location
    Write-Host "Dependencies installed" -ForegroundColor Green
    
    # Mark first run complete
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    "Completed: $timestamp" | Set-Content $FirstRunFile
    
    Write-Host ""
    Write-Host "Setup complete!" -ForegroundColor Green
    Write-Host ""
}

# Re-read settings before starting to ensure we have latest values
$currentSettings = Get-SettingsFromFile
if ($currentSettings -and $currentSettings.settings) {
    if ($currentSettings.settings.frontendPort) {
        $frontendPort = $currentSettings.settings.frontendPort
    }
    if ($currentSettings.settings.httpProxy) {
        $httpProxy = $currentSettings.settings.httpProxy
    }
    if ($currentSettings.settings.noProxy) {
        $noProxy = $currentSettings.settings.noProxy
    }
}

# Start the application
Write-Status ""
Write-Status "Starting Container Image Compare..." "Cyan"
Write-Status "   URL: http://localhost:$frontendPort" "Gray"
if ($httpProxy) {
    Write-Status "   Proxy: $httpProxy" "Gray"
}
if ($noProxy) {
    Write-Status "   No-proxy: $noProxy" "Gray"
}
Write-Status ""

# Set environment variables
$env:PORT = $frontendPort
$env:APP_DATA_DIR = Join-Path $DataDir "appdata"
$env:NODE_ENV = "production"
if ($httpProxy) {
    $env:HTTP_PROXY = $httpProxy
    $env:HTTPS_PROXY = $httpProxy
}
if ($noProxy) {
    $env:NO_PROXY = $noProxy
}

# Paths
$backendDir = Join-Path $AppDir "backend"
# Note: TypeScript compiles to dist/backend/src/server.js due to rootDir: ".." in tsconfig
$serverJsPath = Join-Path $backendDir "dist\backend\src\server.js"

# Start backend server (serves both API and frontend in production mode)
Write-Status "Starting server..." "Yellow"

# Create log files for server output
$logsDir = Join-Path $DataDir "appdata\logs"
if (-not (Test-Path $logsDir)) {
    New-Item -ItemType Directory -Path $logsDir -Force | Out-Null
}
$serverLogFile = Join-Path $logsDir "server.log"
$serverErrFile = Join-Path $logsDir "server.err.log"

# Verify server.js exists
if (-not (Test-Path $serverJsPath)) {
    Write-Host "Error: Server file not found at: $serverJsPath" -ForegroundColor Red
    if (-not $Silent) { Read-Host "Press Enter to exit" }
    exit 1
}

# Store the process ID in a file so we can clean up if needed
$pidFile = Join-Path $DataDir ".server.pid"

# Function to cleanup server process
function Stop-ServerProcess {
    param($ProcessId)
    if ($ProcessId) {
        try {
            $proc = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
            if ($proc -and -not $proc.HasExited) {
                Write-Host "`nShutting down server..." -ForegroundColor Yellow
                Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
                # Wait a moment for process to exit
                Start-Sleep -Milliseconds 500
            }
        }
        catch { }
    }
    # Clean up pid file
    if (Test-Path $pidFile) {
        Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
    }
}

# Check if there's an orphaned server process from a previous run
if (Test-Path $pidFile) {
    $oldPid = Get-Content $pidFile -ErrorAction SilentlyContinue
    if ($oldPid) {
        try {
            $oldProc = Get-Process -Id $oldPid -ErrorAction SilentlyContinue
            if ($oldProc -and $oldProc.ProcessName -eq "node") {
                Write-Host "Stopping previous server instance..." -ForegroundColor Yellow
                Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue
                Start-Sleep -Seconds 1
            }
        }
        catch { }
    }
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}

# Start the server process
# Using separate files for stdout and stderr (PowerShell requirement)
$backendProcess = Start-Process -FilePath $NodeExe -ArgumentList $serverJsPath -WorkingDirectory $backendDir -PassThru -RedirectStandardOutput $serverLogFile -RedirectStandardError $serverErrFile -WindowStyle Hidden

# Save the PID
$backendProcess.Id | Set-Content $pidFile

# Register cleanup on script exit
$null = Register-EngineEvent -SourceIdentifier PowerShell.Exiting -Action {
    if (Test-Path $pidFile) {
        $pid = Get-Content $pidFile -ErrorAction SilentlyContinue
        if ($pid) {
            Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
        }
        Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
    }
}

# Wait for server to be ready before opening browser
$maxWaitSeconds = 30
$waitedSeconds = 0
$serverReady = $false

Write-Status "Waiting for server to be ready..." "Gray"
while ($waitedSeconds -lt $maxWaitSeconds -and -not $serverReady) {
    Start-Sleep -Seconds 1
    $waitedSeconds++
    
    # Check if process crashed
    if ($backendProcess.HasExited) {
        Write-Host ""
        Write-Host "Server process exited unexpectedly!" -ForegroundColor Red
        if (Test-Path $serverLogFile) {
            Write-Host "Server output (last 30 lines):" -ForegroundColor Yellow
            Get-Content $serverLogFile -Tail 30 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "  $_" }
        }
        if ((Test-Path $serverErrFile) -and (Get-Item $serverErrFile).Length -gt 0) {
            Write-Host "Server errors:" -ForegroundColor Red
            Get-Content $serverErrFile -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "  $_" }
        }
        if (-not $Silent) { Read-Host "Press Enter to exit" }
        exit 1
    }
    
    try {
        $null = Invoke-WebRequest -Uri "http://localhost:$frontendPort/api/health" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
        $serverReady = $true
    }
    catch {
        # Server not ready yet
        Write-Host "." -NoNewline
    }
}
Write-Host ""

if ($serverReady) {
    Write-Status "Server started successfully!" "Green"
    Write-Status ""
    
    # Open browser
    Write-Status "Opening browser..." "Yellow"
    Start-Process "http://localhost:$frontendPort"
    
    Write-Status ""
    Write-Status "========================================" "Cyan"
    Write-Status "  Container Image Compare is running!" "Cyan"
    Write-Status "  URL: http://localhost:$frontendPort" "White"
    Write-Status "  Press any key to stop the server..." "Gray"
    Write-Status "========================================" "Cyan"
    Write-Status ""
    
    # Wait for user input or process exit
    try {
        while (-not $backendProcess.HasExited) {
            if ([Console]::KeyAvailable) {
                $null = [Console]::ReadKey($true)
                break
            }
            Start-Sleep -Milliseconds 200
        }
    }
    catch {
        # Error reading key (e.g., redirected input)
        $backendProcess.WaitForExit()
    }
    finally {
        Stop-ServerProcess -ProcessId $backendProcess.Id
    }
}
else {
    Write-Host "Server failed to start within $maxWaitSeconds seconds" -ForegroundColor Red
    Write-Host "Check the logs at: $($env:APP_DATA_DIR)\logs\" -ForegroundColor Yellow
    Stop-ServerProcess -ProcessId $backendProcess.Id
}

# Final cleanup
Write-Host "Goodbye!" -ForegroundColor Cyan
