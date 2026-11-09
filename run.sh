#!/usr/bin/env bash
# Start the dashboard on http://localhost:4602 . Ctrl-C stops it.
set -euo pipefail
cd "$(dirname "$0")"
# ~/.bashrc pins PYTHONHOME/PYTHONPATH to a 3.12 install for DCIM; they break this 3.13 venv.
unset PYTHONHOME PYTHONPATH
exec uv run python -m csm "$@"
