#!/bin/bash
# Boundary CLI wrapper that routes through host.docker.internal with proper Host header
# This is needed because we're in Docker and need to reach the K8s ingress

export BOUNDARY_ADDR="${BOUNDARY_ADDR:-https://boundary.local}"
export BOUNDARY_TLS_INSECURE="${BOUNDARY_TLS_INSECURE:-true}"

# For authentication, we need special handling
# The wrapper passes through to the real boundary CLI
exec /workspace/boundary "$@"
