#!/usr/bin/env bash
set -euo pipefail

# Ensure standard Docker paths are available in PATH
export PATH="/Users/thirumalaibarath/.orbstack/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

REGISTRY="delta.nitt.edu"
TAG="${1:-latest}"
GHCR_OWNER="${2:-thirumalaibarath}"
PROJECT="docmost"

SOURCE_IMAGE="ghcr.io/${GHCR_OWNER}/${PROJECT}:${TAG}"
TARGET_FLAT="${REGISTRY}/${PROJECT}:${TAG}"
TARGET_SCOPED="${REGISTRY}/${PROJECT}/${PROJECT}:${TAG}"

echo "=========================================================="
echo " Mirroring Docmost from GHCR to Delta Registry"
echo "=========================================================="
echo "Source Image : ${SOURCE_IMAGE}"
echo "Target Flat  : ${TARGET_FLAT}"
echo "Target Scoped: ${TARGET_SCOPED}"
echo "Platform     : linux/amd64"
echo "=========================================================="

echo ""
echo "1. Pulling ${SOURCE_IMAGE} for linux/amd64..."
docker pull --platform linux/amd64 "${SOURCE_IMAGE}"

echo ""
echo "2. Tagging images for ${REGISTRY}..."
docker tag "${SOURCE_IMAGE}" "${TARGET_FLAT}"
docker tag "${SOURCE_IMAGE}" "${TARGET_SCOPED}"

echo ""
echo "3. Pushing images to ${REGISTRY}..."
docker push "${TARGET_FLAT}"
docker push "${TARGET_SCOPED}"

echo ""
echo "=========================================================="
echo "Successfully pushed Docmost image to ${REGISTRY}!"
echo "Flat Tag   : ${TARGET_FLAT}"
echo "Scoped Tag : ${TARGET_SCOPED}"
echo "=========================================================="
