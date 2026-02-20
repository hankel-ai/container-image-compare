pushd .
cd %~dp0..
tar -czf "\Users\%USERNAME%\container-image-compare.tar.gz" --exclude=node_modules --exclude=appdata frontend backend shared docker .dockerignore
popd
set KUBECONFIG = "C:\Users\jhankel\OneDrive - OpenText\VSCode\ai\container-image-compare\.kube\kubeconfig-container-image-compare"
kubectl -ncontainer-image-compare exec -it dind -- sh -c "rm -rf /tmp/* /tmp/.[^.]*"
kubectl -ncontainer-image-compare cp "\Users\%USERNAME%\container-image-compare.tar.gz" dind:/tmp
kubectl -ncontainer-image-compare exec -it dind -- sh -c "set -e; cd /tmp ; tar -xvf container-image-compare.tar.gz ; rm ./container-image-compare.tar.gz ; sed -i 's/#ARG HTTP/ARG HTTP/g' ./docker/Dockerfile ; docker build --no-cache . -f ./docker/Dockerfile -t container-image-compare:latest ; docker tag container-image-compare:latest gtsrepo02.cslab.otxlab.net:8083/tools/container-image-compare:latest ; docker push gtsrepo02.cslab.otxlab.net:8083/tools/container-image-compare:latest"

@echo off
if %ERRORLEVEL% neq 0 (
    echo ERROR: Failed to build and push container image
    exit /b %ERRORLEVEL%
)
@echo on

kubectl -ncontainer-image-compare delete pod -l app.kubernetes.io/name=container-image-compare
kubectl -ncontainer-image-compare wait pod -l app.kubernetes.io/name=container-image-compare --for condition=Ready --timeout=600s
REM kubectl -ncontainer-image-compare logs -l app.kubernetes.io/name=container-image-compare -f
