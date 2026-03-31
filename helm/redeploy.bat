@echo off
setlocal

set IMAGE=ghcr.io/hankel-ai/container-image-compare
set TAG=latest
set NAMESPACE=container-image-compare

echo === Building Docker image ===
docker build -f "%~dp0..\docker\Dockerfile" -t %IMAGE%:%TAG% "%~dp0.."
if %ERRORLEVEL% neq 0 (
    echo ERROR: Docker build failed
    exit /b %ERRORLEVEL%
)

echo === Pushing to GHCR ===
docker push %IMAGE%:%TAG%
if %ERRORLEVEL% neq 0 (
    echo ERROR: Push failed. Run: docker login ghcr.io -u hankel-ai
    exit /b %ERRORLEVEL%
)

echo === Deploying via Helm ===
helm upgrade --install container-image-compare "%~dp0container-image-compare" ^
    --namespace %NAMESPACE% ^
    --create-namespace ^
    --set image.tag=%TAG% ^
    --wait --timeout 10m
if %ERRORLEVEL% neq 0 (
    echo ERROR: Helm deploy failed
    exit /b %ERRORLEVEL%
)

echo === Deploy complete ===
kubectl get pods -n %NAMESPACE%
pause
