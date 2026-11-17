#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${HOME:-/}" 2>/dev/null || cd / 2>/dev/null || true
exec "$HERE/Ogranka" "$@"
