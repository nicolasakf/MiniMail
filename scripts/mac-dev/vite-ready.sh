#!/bin/sh
printf 'MINIMAIL_RENDERER_URL=%s\n' "${ELECTRON_RENDERER_URL:?}"
cat >/dev/null
