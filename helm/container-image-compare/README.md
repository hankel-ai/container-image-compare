# Container Image Compare Helm Chart

This Helm chart deploys Container Image Compare on Kubernetes.

## Prerequisites

- Kubernetes 1.19+
- Helm 3.0+
- A container image built from the Dockerfile in this repository

## Building the Container Image

Before deploying with Helm, build and push the container image:

```bash
# Build the image
docker build -t your-registry/container-image-compare:1.0.0 .

# Push to your registry
docker push your-registry/container-image-compare:1.0.0
```

## Installation

### Quick Start

```bash
# Install with default values
helm install cic ./helm/container-image-compare \
  --set image.repository=your-registry/container-image-compare

# Install in a specific namespace
helm install cic ./helm/container-image-compare \
  --namespace container-image-compare \
  --create-namespace \
  --set image.repository=your-registry/container-image-compare
```

### With Custom Values

Create a `my-values.yaml` file:

```yaml
image:
  repository: your-registry/container-image-compare
  tag: "1.0.0"

ingress:
  enabled: true
  hosts:
    - host: cic.example.com
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: cic-tls
      hosts:
        - cic.example.com

proxy:
  httpProxy: "http://proxy.example.com:8080"
  httpsProxy: "http://proxy.example.com:8080"

persistence:
  size: 50Gi
```

Then install:

```bash
helm install cic ./helm/container-image-compare -f my-values.yaml
```

## Configuration

| Parameter | Description | Default |
|-----------|-------------|---------|
| `replicaCount` | Number of replicas | `1` |
| `image.repository` | Container image repository | `container-image-compare` |
| `image.tag` | Container image tag | `""` (uses appVersion) |
| `image.pullPolicy` | Image pull policy | `IfNotPresent` |
| `service.type` | Kubernetes service type | `ClusterIP` |
| `service.port` | Service port | `5000` |
| `ingress.enabled` | Enable ingress | `true` |
| `ingress.className` | Ingress class name | `""` (uses default) |
| `ingress.hosts` | Ingress hosts configuration | See values.yaml |
| `persistence.enabled` | Enable persistent storage | `true` |
| `persistence.storageClassName` | Storage class | `""` (uses default) |
| `persistence.size` | PVC size | `20Gi` |
| `proxy.httpProxy` | HTTP proxy URL | `""` |
| `proxy.httpsProxy` | HTTPS proxy URL | `""` |
| `proxy.noProxy` | No proxy hosts | `localhost,127.0.0.1,.cluster.local` |
| `config.maxCacheSizeGB` | Max cache size in GB | `20` |
| `config.maxHistoryItems` | Max history items | `50` |
| `config.skipTlsVerify` | Skip TLS verification | `true` |

## Upgrading

```bash
helm upgrade cic ./helm/container-image-compare -f my-values.yaml
```

## Uninstalling

```bash
helm uninstall cic

# If you want to delete the PVC as well
kubectl delete pvc cic-container-image-compare
```

## Proxy Configuration

To configure proxy settings for registry connections:

```yaml
proxy:
  httpProxy: "http://proxy.example.com:8080"
  httpsProxy: "http://proxy.example.com:8080"
  noProxy: "localhost,127.0.0.1,.cluster.local,internal-registry.local"
```

## Using Private Registries

If your container image is in a private registry:

```yaml
imagePullSecrets:
  - name: my-registry-secret
```

Create the secret first:
```bash
kubectl create secret docker-registry my-registry-secret \
  --docker-server=your-registry.com \
  --docker-username=user \
  --docker-password=password
```
