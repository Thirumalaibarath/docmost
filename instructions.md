# Pushing Docker Images to the Delta Registry (`delta.nitt.edu`)

This guide provides step-by-step instructions for building, tagging, and pushing Docker images to Delta Force's private production registry (`delta.nitt.edu`), whether you are building images locally or mirroring external images from GitHub Container Registry (GHCR) or Docker Hub.

---

## 1. Registry Details & Prerequisites

- **Registry Domain**: `delta.nitt.edu`
- **Target Server Architecture**: `linux/amd64` (Production servers run x86_64 architecture).
- **Local Environment**: If you are developing on Apple Silicon (M1/M2/M3/M4 Macs), you **must** build or pull images targeting `--platform linux/amd64`.

### Authentication
Before pushing, ensure your local Docker daemon is authenticated with the Delta registry:
```bash
docker login delta.nitt.edu
```
*(Enter your Delta server credentials when prompted).*

To verify that your authentication is active, check:
```bash
cat ~/.docker/config.json | grep -A 2 "delta.nitt.edu"
```

---

## 2. Image Naming & Tagging Conventions

The Delta registry supports both namespaced (grouped by project) and flat repository paths. It is recommended to use the namespaced convention or tag both for backward compatibility with existing compose setups:

1. **Namespaced / Scoped (Recommended)**:
   ```
   delta.nitt.edu/<project>/<service>:<tag>
   ```
   *Examples:*
   - `delta.nitt.edu/plane/plane-backend:latest`
   - `delta.nitt.edu/docmost/client:latest`
   - `delta.nitt.edu/dashboard/web:v1.2.0`

2. **Flat / Direct**:
   ```
   delta.nitt.edu/<service>:<tag>
   ```
   *Examples:*
   - `delta.nitt.edu/plane-backend:latest`
   - `delta.nitt.edu/docmost:latest`

3. **Tags**:
   - `latest` (Default for production tracking)
   - Commit SHA (e.g., `:87ce04f`)
   - Semantic Versioning (e.g., `:v1.0.4`)

---

## 3. Workflow A: Mirroring Images from an External Registry (GHCR / Docker Hub)

Use this method when GitHub Actions or CI/CD has already built and published images to GHCR or Docker Hub, and you need to deploy them to Delta's server.

### Step 1: Pull with Target Architecture
> **Important**: Always pass `--platform linux/amd64` when pulling on macOS to avoid `no matching manifest for linux/arm64` errors.

```bash
docker pull --platform linux/amd64 <source-image>:<source-tag>
```

### Step 2: Tag for Delta Registry
```bash
docker tag <source-image>:<source-tag> delta.nitt.edu/<project>/<service>:<target-tag>
```

### Step 3: Push to Registry
```bash
docker push delta.nitt.edu/<project>/<service>:<target-tag>
```

### Single Service Example:
```bash
# Pull from GHCR
docker pull --platform linux/amd64 ghcr.io/thirumalaibarath/plane-frontend:latest

# Tag for Delta registry (both namespaced and flat)
docker tag ghcr.io/thirumalaibarath/plane-frontend:latest delta.nitt.edu/plane/plane-frontend:latest
docker tag ghcr.io/thirumalaibarath/plane-frontend:latest delta.nitt.edu/plane-frontend:latest

# Push
docker push delta.nitt.edu/plane/plane-frontend:latest
docker push delta.nitt.edu/plane-frontend:latest
```

### Docmost Example:
```bash
# Automated via script:
./push_to_delta.sh

# Or manually:
docker pull --platform linux/amd64 ghcr.io/thirumalaibarath/docmost:latest

docker tag ghcr.io/thirumalaibarath/docmost:latest delta.nitt.edu/docmost:latest
docker tag ghcr.io/thirumalaibarath/docmost:latest delta.nitt.edu/docmost/docmost:latest

docker push delta.nitt.edu/docmost:latest
docker push delta.nitt.edu/docmost/docmost:latest
```

---

## 4. Workflow B: Building and Pushing from Local Source Code

When developing a new service or custom fork (e.g., Docmost, custom dashboards, microservices), build the image directly for `linux/amd64`.

### Option 1: Standard Docker Build & Push
```bash
cd /path/to/project

# 1. Build for production architecture
docker build --platform linux/amd64 -t delta.nitt.edu/<project>/<service>:latest -f Dockerfile .

# 2. Push to Delta registry
docker push delta.nitt.edu/<project>/<service>:latest
```

### Option 2: Docker Buildx (Direct Build & Push)
If Docker Buildx is enabled, you can build and push in a single step with cross-compilation:
```bash
docker buildx build \
  --platform linux/amd64 \
  -t delta.nitt.edu/<project>/<service>:latest \
  --push \
  .
```

---

## 5. Workflow C: Batch Script for Multi-Service Projects

For projects with multiple microservices (e.g., Plane, Docmost, microservice suites), use the following automated Bash script:

Save as `push_to_delta.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail

REGISTRY="delta.nitt.edu"
PROJECT="plane" # Change to your project namespace, e.g., "docmost", "plane", etc.
TAG="latest"

# List of services to process
SERVICES=(
  "frontend"
  "backend"
  "admin"
  "space"
  "proxy"
  "live"
)

SOURCE_PREFIX="ghcr.io/thirumalaibarath/plane-"

for svc in "${SERVICES[@]}"; do
  echo "========================================="
  echo "Processing: ${svc}"
  echo "========================================="

  SOURCE_IMG="${SOURCE_PREFIX}${svc}:${TAG}"
  TARGET_SCOPED="${REGISTRY}/${PROJECT}/plane-${svc}:${TAG}"
  TARGET_FLAT="${REGISTRY}/plane-${svc}:${TAG}"

  echo "1. Pulling ${SOURCE_IMG} (linux/amd64)..."
  docker pull --platform linux/amd64 "${SOURCE_IMG}"

  echo "2. Tagging..."
  docker tag "${SOURCE_IMG}" "${TARGET_SCOPED}"
  docker tag "${SOURCE_IMG}" "${TARGET_FLAT}"

  echo "3. Pushing to Delta registry..."
  docker push "${TARGET_SCOPED}"
  docker push "${TARGET_FLAT}"

  echo "Done with ${svc}."
done

echo "========================================="
echo "All images pushed successfully to ${REGISTRY}!"
```

Run with:
```bash
chmod +x push_to_delta.sh
./push_to_delta.sh
```

---

## 6. Deploying on the Production Server (`delta-server`)

Once pushed, pull and run the updated containers on the server:

1. **SSH into the production server**:
   ```bash
   ssh delta@delta.nitt.edu
   ```

2. **Navigate to your deployment directory**:
   ```bash
   cd /opt/deployments/<project>
   ```

3. **Ensure `docker-compose.yml` references the Delta registry**:
   ```yaml
   services:
     web:
       image: delta.nitt.edu/plane/plane-frontend:latest
       # or image: delta.nitt.edu/docmost:latest
       restart: always
   ```

4. **Pull latest images and restart containers**:
   ```bash
   docker compose pull
   docker compose up -d
   ```

5. **Clean up old/dangling images**:
   ```bash
   docker image prune -f
   ```

---

## 7. Troubleshooting & Gotchas

### 1. `Error response from daemon: no matching manifest for linux/arm64/v8`
- **Cause**: Pulling an image built only for AMD64 on an Apple Silicon Mac.
- **Fix**: Always specify `--platform linux/amd64` when pulling:
  ```bash
  docker pull --platform linux/amd64 <image>:<tag>
  ```

### 2. Zsh Variable Expansion Bug (`plane-adminatest:latest`)
- **Cause**: In `zsh`, `$var:l` is a modifier that transforms `$var` to lower-case. Writing `$svc:latest` causes `zsh` to parse `$svc:l` + `atest`.
- **Fix**: Always wrap shell variable names in curly braces:
  ```bash
  # INCORRECT in zsh:
  docker tag $svc:latest delta.nitt.edu/$svc:latest

  # CORRECT:
  docker tag ${svc}:latest delta.nitt.edu/${svc}:latest
  ```

### 3. `unauthorized: authentication required` / `401 Unauthorized`
- **Cause**: Docker credentials expired or missing for `delta.nitt.edu`.
- **Fix**: Re-authenticate:
  ```bash
  docker login delta.nitt.edu
  ```

### 4. OrbStack / Docker Daemon Not Running
- If running on macOS with OrbStack:
  ```bash
  orbctl start
  export PATH="$HOME/.orbstack/bin:$PATH"
  ```
