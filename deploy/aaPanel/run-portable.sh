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
NODE_HOME="$RUNTIME_DIR/node-v${NODE_VERSION}-linux-${NODE_ARCH}"
if [ ! -x "$NODE_HOME/bin/node" ]; then
  echo 'Chưa có Node portable. Chạy sh setup-portable.sh trước.' >&2
  exit 1
fi

export PATH="$NODE_HOME/bin:$PATH"
cd "$APP_DIR"
exec sh ./start.sh
