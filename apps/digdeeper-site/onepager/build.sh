#!/usr/bin/env sh
# Render onepager/overview.html to ../public/overview.pdf with headless Chrome.
# The PDF must be exactly one US Letter page and under 1 MB.
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/../public/overview.pdf"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"

if [ ! -x "$CHROME" ]; then
  echo "Google Chrome not found at: $CHROME" >&2
  echo "Set CHROME to the Chrome or Chromium binary and re-run." >&2
  exit 1
fi

"$CHROME" --headless=new --disable-gpu --no-pdf-header-footer \
  --print-to-pdf="$OUT" "file://$HERE/overview.html" 2>/dev/null

SIZE=$(wc -c < "$OUT" | tr -d ' ')
echo "wrote $OUT ($SIZE bytes)"
if command -v mdls >/dev/null 2>&1; then
  mdls -name kMDItemNumberOfPages "$OUT" || true
fi
if [ "$SIZE" -gt 1000000 ]; then
  echo "PDF is over 1 MB, which breaks the acceptance criterion." >&2
  exit 1
fi
