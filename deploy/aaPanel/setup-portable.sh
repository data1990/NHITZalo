#!/bin/sh
set -eu

APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
NODE_VERSION=24.22.0
case "$(uname -m)" in
  x86_64) NODE_ARCH=x64 ;;
  aarch64) NODE_ARCH=arm64 ;;
  *) echo 'VPS cần kiến trúc x86_64 hoặc aarch64.' >&2; exit 1 ;;
esac

RUNTIME_DIR=${WEB_RUNTIME_DIR:-/www/server/nhitzalo-web/runtime}
mkdir -p "$RUNTIME_DIR"
cd "$RUNTIME_DIR"
ARCHIVE="node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz"
BASE_URL="https://nodejs.org/dist/v${NODE_VERSION}"
curl -fsSLO "$BASE_URL/$ARCHIVE"
curl -fsSLO "$BASE_URL/SHASUMS256.txt"
grep -F "  $ARCHIVE" SHASUMS256.txt | sha256sum -c -
tar -xJf "$ARCHIVE"

export PATH="$RUNTIME_DIR/node-v${NODE_VERSION}-linux-${NODE_ARCH}/bin:$PATH"
node --version
npm install --omit=dev --prefix "$APP_DIR"
echo 'Đã chuẩn bị Node portable và dependency của Web Host.'
