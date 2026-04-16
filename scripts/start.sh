#!/bin/sh
# Railway / Docker entrypoint.
#
# The API process owns the container's lifecycle — it runs in the
# foreground via `exec`, so Node's native signal handling governs
# graceful shutdown and the API is what Railway's healthcheck sees.
#
# Workers (and the optional Telegram bot) run in the background. They
# share the same SQLite DB via WAL mode and claim jobs from their
# respective tables. Crashes are self-contained: if a worker dies, it
# goes into the logs and the API keeps serving. We deliberately DO NOT
# install a `wait -n` / cleanup trap — that pattern takes the whole
# container down on any sibling death and broke Railway healthchecks.

log() { echo "[start.sh] $*"; }

log "launching jobs worker"
node --import tsx/esm src/worker/index.ts &

log "launching producer worker"
node --import tsx/esm src/worker/producerIndex.ts &

# Telegram bot is optional. Without a token, telegraf throws at module
# load and the process would crash-loop, so we only launch when it's
# actually configured.
if [ -n "$TELEGRAM_BOT_TOKEN" ]; then
  log "launching telegram bot"
  node --import tsx/esm src/telegram/index.ts &
else
  log "TELEGRAM_BOT_TOKEN not set — skipping telegram bot"
fi

log "launching API (foreground) — PORT=${PORT:-3000}"
exec node --import tsx/esm src/api/server.ts
