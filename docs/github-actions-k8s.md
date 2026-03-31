# GitHub Actions CI/CD with Kubernetes

This guide covers deploying a GitHub Actions self-hosted runner in a K3s cluster using Actions Runner Controller (ARC), with GHCR as the container registry. The pattern is reusable across repos -- the only repo-specific values are the GitHub URL and Helm release names.

## Architecture

```
Push to main
  |
  v
Job 1: build (GitHub-hosted runner)
  - Builds Docker image
  - Pushes to ghcr.io/<org>/<repo>:<sha> and :latest
  |
  v
Job 2: deploy (self-hosted ARC runner in K3s)
  - Runs helm upgrade --install with --set image.tag=<sha>
  - Waits for rollout to complete
```

- **Build** runs on GitHub's infrastructure (free for public repos, no security risk)
- **Deploy** runs on an ephemeral runner pod inside the cluster (scales to zero when idle)
- **GHCR** is free for public repos and doesn't require exposing an internal registry

## Prerequisites

- K3s cluster (or any Kubernetes cluster)
- `kubectl` and `helm` installed locally
- `gh` CLI authenticated to GitHub

## Step 1: Install Actions Runner Controller (ARC)

ARC v2 is the official GitHub-supported controller for running self-hosted runners in Kubernetes.

```bash
helm install arc \
  --namespace arc-systems \
  --create-namespace \
  oci://ghcr.io/actions/actions-runner-controller-charts/gha-runner-scale-set-controller
```

Verify the controller is running:

```bash
kubectl get pods -n arc-systems
# Expected: arc-gha-rs-controller-xxxxx  1/1  Running
```

## Step 2: Create a GitHub PAT

Create a fine-grained Personal Access Token at GitHub > Settings > Developer Settings > Fine-grained PATs:

- **Resource owner**: Your GitHub org or user
- **Repository access**: Select the target repo(s)
- **Permissions**: Administration (Read and write), Metadata (Read)

Create the K8s secret:

```bash
kubectl create namespace arc-runners
kubectl create secret generic github-pat \
  --namespace arc-runners \
  --from-literal=github_token=<YOUR_PAT>
```

## Step 3: Install a runner scale set

Each runner scale set is tied to a specific GitHub repo. The Helm release name (e.g., `arc-runner-set`) becomes the `runs-on` label in your workflow.

```bash
helm install arc-runner-set \
  --namespace arc-runners \
  oci://ghcr.io/actions/actions-runner-controller-charts/gha-runner-scale-set \
  --set githubConfigUrl="https://github.com/<org>/<repo>" \
  --set githubConfigSecret=github-pat \
  --set minRunners=0 \
  --set maxRunners=1
```

Verify the listener is running:

```bash
kubectl get pods -n arc-systems
# Expected: arc-runner-set-xxxxx-listener  1/1  Running
```

The listener polls GitHub for queued jobs. When a workflow targets `runs-on: arc-runner-set`, ARC spins up an ephemeral runner pod in `arc-runners`, executes the job, then tears it down.

## Step 4: Grant RBAC permissions

The runner pod needs permissions to run `helm upgrade` against the target namespace. The runner's service account is named `<release>-gha-rs-no-permission` by default.

```bash
kubectl create clusterrolebinding arc-runner-admin \
  --clusterrole=cluster-admin \
  --serviceaccount=arc-runners:arc-runner-set-gha-rs-no-permission
```

> For production, create a scoped Role limited to specific namespaces instead of cluster-admin.

## Step 5: Make the GHCR package public

After the first successful build pushes an image to GHCR, the package defaults to **private**. To allow the cluster to pull without an `imagePullSecret`:

1. Go to `https://github.com/<org>?tab=packages`
2. Click the package name
3. Click **Package settings** (right sidebar)
4. Scroll to **Danger Zone** > **Change package visibility**
5. Select **Public** and confirm

Alternatively, keep it private and create an `imagePullSecret`:

```bash
kubectl create secret docker-registry ghcr-pull \
  --namespace <app-namespace> \
  --docker-server=ghcr.io \
  --docker-username=<github-user> \
  --docker-password=<PAT-with-read-packages>
```

Then reference it in your Helm values:

```yaml
imagePullSecrets:
  - name: ghcr-pull
```

## Workflow file

The workflow file (`.github/workflows/deploy.yml`) needs two jobs. The build job runs on GitHub-hosted runners and the deploy job targets the ARC runner by its Helm release name:

```yaml
name: Build and Deploy

on:
  push:
    branches: [main]
    paths:
      - 'src/**'        # adjust to your project
      - 'helm/**'
      - '.github/workflows/**'
  workflow_dispatch:

jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v6
        with:
          context: .
          file: docker/Dockerfile
          push: true
          tags: |
            ghcr.io/<org>/<repo>:${{ github.sha }}
            ghcr.io/<org>/<repo>:latest

  deploy:
    needs: build
    runs-on: arc-runner-set          # must match the Helm release name
    steps:
      - uses: actions/checkout@v4
      - name: Install helm
        uses: azure/setup-helm@v4
      - name: Deploy
        run: |
          helm upgrade --install <release> \
            ./helm/<chart> \
            --namespace <namespace> \
            --create-namespace \
            --set image.tag="${{ github.sha }}" \
            --wait --timeout 10m
```

Key points:
- `GITHUB_TOKEN` is automatically provided -- no PAT needed for GHCR push
- Only triggers on `push` to `main`, not `pull_request` (prevents fork abuse on public repos)
- `workflow_dispatch` enables manual re-runs from the Actions tab

## Security considerations for public repos

- **Never trigger self-hosted runners on `pull_request`** -- forks can run arbitrary code on your cluster
- **Restrict fork PR workflows** in repo Settings > Actions > General: set to "Require approval for all outside collaborators"
- **Minimize workflow permissions**: the build job only needs `contents: read` and `packages: write`
- **Secrets stay private**: `GITHUB_TOKEN` and repo secrets are never exposed in workflow files or logs
- **ARC runners are ephemeral**: pods are created per-job and destroyed after, reducing attack surface

## Troubleshooting

**Runner not picking up jobs**: Check the `runs-on` label matches the Helm release name exactly. Check listener logs:

```bash
kubectl logs -n arc-systems -l app.kubernetes.io/name=arc-runner-set-listener --tail=20
```

**RBAC errors during helm upgrade**: Verify the clusterrolebinding exists and references the correct service account:

```bash
kubectl get clusterrolebinding arc-runner-admin -o yaml
```

**GHCR pull fails (ImagePullBackOff)**: Either make the package public or create an `imagePullSecret` (see Step 5).

**Build fails with `npm ci` error**: Ensure `package-lock.json` is committed (not in `.gitignore`). `npm ci` requires a lockfile.
