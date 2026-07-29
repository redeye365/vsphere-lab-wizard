#!/usr/bin/env bash
# Multi-architecture build (linux/amd64 + linux/arm64, for Raspberry Pi) via docker buildx.
# Pushes to both Docker Hub (redeye365/zero-to-hero) and Harbor.
#
# Harbor credentials are read from HARBOR_USERNAME / HARBOR_PASSWORD -- never hardcoded.
# Docker Hub: either `docker login` beforehand, or set DOCKERHUB_USERNAME / DOCKERHUB_PASSWORD.
set -euo pipefail

PLATFORMS="linux/amd64,linux/arm64"
DOCKERHUB_IMAGE="redeye365/zero-to-hero"

HARBOR_URL="${HARBOR_URL:-harbor.lab.clouditblog.com}"
HARBOR_PROJECT="${HARBOR_PROJECT:-lab-tools}"
HARBOR_IMAGE="${HARBOR_URL}/${HARBOR_PROJECT}/zero-to-hero"

BUILDER_NAME="zero-to-hero-builder"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERSION="$(node -p "require('${SCRIPT_DIR}/package.json').version")"

if [[ -z "${HARBOR_USERNAME:-}" || -z "${HARBOR_PASSWORD:-}" ]]; then
  echo "Error: HARBOR_USERNAME and HARBOR_PASSWORD must be set in the environment." >&2
  exit 1
fi

if [[ -n "${DOCKERHUB_USERNAME:-}" && -n "${DOCKERHUB_PASSWORD:-}" ]]; then
  echo "Logging in to Docker Hub..."
  echo "${DOCKERHUB_PASSWORD}" | docker login -u "${DOCKERHUB_USERNAME}" --password-stdin
fi

echo "Logging in to ${HARBOR_URL}..."
echo "${HARBOR_PASSWORD}" | docker login "${HARBOR_URL}" -u "${HARBOR_USERNAME}" --password-stdin

if ! docker buildx inspect "${BUILDER_NAME}" >/dev/null 2>&1; then
  echo "Creating buildx builder ${BUILDER_NAME}..."
  docker buildx create --name "${BUILDER_NAME}" --use
else
  docker buildx use "${BUILDER_NAME}"
fi

echo "Building and pushing ${PLATFORMS} for version ${VERSION}..."
docker buildx build \
  --platform "${PLATFORMS}" \
  -t "${DOCKERHUB_IMAGE}:${VERSION}" \
  -t "${DOCKERHUB_IMAGE}:latest" \
  -t "${HARBOR_IMAGE}:${VERSION}" \
  -t "${HARBOR_IMAGE}:latest" \
  --push \
  "${SCRIPT_DIR}"

echo "Done. Pushed:"
echo "  ${DOCKERHUB_IMAGE}:${VERSION} / :latest"
echo "  ${HARBOR_IMAGE}:${VERSION} / :latest"
