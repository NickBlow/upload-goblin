#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"

# Prefer Docker Compose on GitHub Actions; otherwise use Podman if available, then Docker Compose.
if [[ -n "${GITHUB_ACTIONS:-}" ]]; then
  echo "Running in GitHub Actions → using Docker Compose"
  COMPOSE_CMD="docker compose"
elif command -v podman >/dev/null 2>&1; then
  echo "Podman detected, using Podman Compose"
  COMPOSE_CMD="podman compose"
else
  echo "Using Docker Compose"
  COMPOSE_CMD="docker compose"
fi

# Tear down any old infra, then bring it up
$COMPOSE_CMD -f "$COMPOSE_FILE" down -v 2>/dev/null || true
$COMPOSE_CMD -f "$COMPOSE_FILE" up -d

echo "Waiting for S3 to be ready..."
until curl -s http://localhost:4566/_localstack/health \
      | grep -E '"s3": "(available|running)"' >/dev/null; do
  sleep 2
done
echo "LocalStack is ready."

export AWS_ACCESS_KEY_ID=test
export AWS_SECRET_ACCESS_KEY=test
export AWS_DEFAULT_REGION=us-east-1

# Create S3 bucket (ignore error if it already exists)
aws --endpoint-url=http://localhost:4566 s3api create-bucket \
  --bucket test-bucket \
  --region us-east-1 || true

echo "✅ test-bucket created."
