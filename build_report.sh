#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$ROOT/Отчет"
BUILD="$(mktemp -d "${TMPDIR:-/tmp}/ogranka-report.XXXXXX")"
trap 'rm -rf "$BUILD"' EXIT

PDFLATEX="${PDFLATEX:-}"
if [ -z "$PDFLATEX" ]; then
  if command -v pdflatex >/dev/null 2>&1; then
    PDFLATEX="$(command -v pdflatex)"
  elif [ -x "$HOME/Library/TinyTeX/bin/universal-darwin/pdflatex" ]; then
    PDFLATEX="$HOME/Library/TinyTeX/bin/universal-darwin/pdflatex"
  else
    echo "pdflatex не найден. Установите TeX Live/TinyTeX или задайте PDFLATEX." >&2
    exit 1
  fi
fi

cd "$SRC"
for pass in 1 2; do
  if ! "$PDFLATEX" -interaction=nonstopmode -halt-on-error \
      -output-directory="$BUILD" Dyachenko_AM.tex >"$BUILD/pass-$pass.log" 2>&1; then
    echo "Сборка не удалась на проходе $pass:" >&2
    tail -n 40 "$BUILD/pass-$pass.log" >&2
    exit 1
  fi
done

cp "$BUILD/Dyachenko_AM.pdf" "$ROOT/Dyachenko_AM.pdf"
echo "Готово: $ROOT/Dyachenko_AM.pdf"
