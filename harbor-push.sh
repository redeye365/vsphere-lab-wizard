#!/usr/bin/env bash
# Builds the zero-to-hero image and pushes it to Harbor.
# Harbor credentials are read from HARBOR_USERNAME / HARBOR_PASSWORD env vars -- never
# hardcoded here. HARBOR_URL / HARBOR_PROJECT can be overridden for other registries.
set -euo pipefail

HARBOR_URL="${HARBOR_URL:-harbor.lab.clouditblog.com}"
HARBOR_PROJECT="${HARBOR_PROJECT:-lab-tools}"
IMAGE_NAME="zero-to-hero"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERSION="$(node -p "require('${SCRIPT_DIR}/package.json').version")"

if [[ -z "${HARBOR_USERNAME:-}" || -z "${HARBOR_PASSWORD:-}" ]]; then
  echo "Error: HARBOR_USERNAME and HARBOR_PASSWORD must be set in the environment." >&2
  exit 1
fi

TARGET_IMAGE="${HARBOR_URL}/${HARBOR_PROJECT}/${IMAGE_NAME}"

echo "Building ${IMAGE_NAME}:${VERSION}..."
docker build -t "${IMAGE_NAME}:${VERSION}" "${SCRIPT_DIR}"

echo "Logging in to ${HARBOR_URL}..."
echo "${HARBOR_PASSWORD}" | docker login "${HARBOR_URL}" -u "${HARBOR_USERNAME}" --password-stdin

echo "Tagging ${TARGET_IMAGE}:${VERSION} and :latest..."
docker tag "${IMAGE_NAME}:${VERSION}" "${TARGET_IMAGE}:${VERSION}"
docker tag "${IMAGE_NAME}:${VERSION}" "${TARGET_IMAGE}:latest"

echo "Pushing to Harbor..."
docker push "${TARGET_IMAGE}:${VERSION}"
docker push "${TARGET_IMAGE}:latest"

echo "Done: ${TARGET_IMAGE}:${VERSION}"
