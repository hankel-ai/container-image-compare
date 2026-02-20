#Docker Desktop
Docker Settings, Docker Engine:

{
  "builder": {
    "gc": {
      "defaultKeepStorage": "20GB",
      "enabled": true
    }
  },
  "experimental": false,
  "insecure-registries": [
    "gtsrepo02.cslab.otxlab.net:8083",
    "gtsrepo01.cslab.otxlab.net:8083"
  ]
}


#Deploy and Auto Build Image
cd "C:\Users\jhankel\OneDrive - OpenText\VSCode\container-image-compare\docker"
docker compose up


- OR -

#Docker in Docker Build
kubectl apply -ncontainer-image-compare -f "C:\Users\JHankel\OneDrive - OpenText\Rancher\docker-in-docker.yaml"
kubectl exec -it -ncontainer-image-compare dind -- sh -c "docker login -u jhankel.lab@otxlab.net gtsrepo02.cslab.otxlab.net:8083"

"C:\Users\jhankel\OneDrive - OpenText\VSCode\ai\container-image-compare\helm\redeploy.bat"


#ERASE all Docker containers/images/networks/build caches
docker system prune -a
docker volume prune -a

#Build Image
docker build . -f ./docker/Dockerfile -t container-image-compare:latest


#Push Image to Registry for helm chart
docker tag container-image-compare:latest gtsrepo02.cslab.otxlab.net:8083/tools/container-image-compare:latest

docker push gtsrepo02.cslab.otxlab.net:8083/tools/container-image-compare:latest


#TEST PULL
docker pull gtsrepo02.cslab.otxlab.net:8083/documentum/d2/d2configcustom:24.2.0
docker pull gtsrepo02.cslab.otxlab.net:8443/documentum/d2/d2configcustom:24.2.0


#DEPLOY
helm upgrade -i cic -ncontainer-image-compare --create-namespace "C:\Users\jhankel\OneDrive - OpenText\VSCode\ai\container-image-compare\helm\container-image-compare" 

kubectl logs -ncontainer-image-compare -l app.kubernetes.io/name=container-image-compare -f


https://cic.cslab.otxlab.net/