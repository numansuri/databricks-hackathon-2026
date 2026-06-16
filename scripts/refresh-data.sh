#!/usr/bin/env bash
# Refresh the bundled gold slices from LIVE Databricks if credentials are present;
# otherwise keep the committed local slices and exit 0 (local-first, never fails).
# Thin wrapper over the pure-stdlib Python driver. See scripts/refresh_data.py.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec python3 "${HERE}/refresh_data.py" "$@"
