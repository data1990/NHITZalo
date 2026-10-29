#!/bin/sh
set -eu

WEB_PUBLIC_ORIGIN=${WEB_PUBLIC_ORIGIN:-https://zalo.ngochoangit.net}

export WEB_HOST=127.0.0.1
export WEB_PORT=${WEB_PORT:-3177}
export WEB_PUBLIC_ORIGIN
export WEB_DATA_DIR=${WEB_DATA_DIR:-/www/server/nhitzalo-web/data}
export WEB_ADMIN_PASSWORD_FILE=${WEB_ADMIN_PASSWORD_FILE:-/www/server/nhitzalo-web/admin-password}
export WEB_DB_HOST=${WEB_DB_HOST:-127.0.0.1}
export WEB_DB_PORT=${WEB_DB_PORT:-3306}
export WEB_DB_NAME=${WEB_DB_NAME:-zalo}
export WEB_DB_USER=${WEB_DB_USER:-zalo}
export WEB_DB_PASSWORD_FILE=${WEB_DB_PASSWORD_FILE:-/www/server/nhitzalo-web/db-password}

exec node server.js
