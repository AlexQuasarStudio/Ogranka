#!/bin/bash
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
APP="$HERE/../Resources/app"
DATA="$HOME/Library/Application Support/ShapePipeline"
mkdir -p "$DATA"

find_python() {
  local candidate
  for candidate in \
    "${OGRANKA_PYTHON:-}" \
    /Library/Frameworks/Python.framework/Versions/3.13/bin/python3 \
    /Library/Frameworks/Python.framework/Versions/3.12/bin/python3 \
    /Library/Frameworks/Python.framework/Versions/3.11/bin/python3 \
    /Library/Frameworks/Python.framework/Versions/3.10/bin/python3 \
    /opt/homebrew/bin/python3.13 \
    /opt/homebrew/bin/python3.12 \
    /opt/homebrew/bin/python3.11 \
    /opt/homebrew/bin/python3 \
    /usr/local/bin/python3 \
    /usr/bin/python3 \
    "$(command -v python3 2>/dev/null || true)"; do
    [ -n "$candidate" ] && [ -x "$candidate" ] || continue
    if "$candidate" -c 'import sys, numpy, scipy, fast_simplification; assert sys.version_info >= (3, 10)' >/dev/null 2>&1; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

PY="$(find_python || true)"
if [ -z "$PY" ]; then
  osascript -e 'display dialog "Не найден Python 3.10+ с numpy, scipy и fast-simplification.\n\nУстановите зависимости командой:\n\npython3 -m pip install numpy scipy fast-simplification" buttons {"OK"} default button 1 with title "Огранка Lite" with icon caution' >/dev/null 2>&1 || true
  exit 1
fi

export OGRANKA_DATA="$DATA"
cd "$APP" || exit 1
exec "$PY" "$APP/app.py" "$@"
