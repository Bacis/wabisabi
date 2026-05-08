#!/bin/sh
# Railway / Docker entrypoint.
#
# The API process owns the container's lifecycle — it runs in the
# foreground via `exec`, so Node's native signal handling governs
# graceful shutdown and the API is what Railway's healthcheck sees.
#
# The jobs worker runs in the background. It shares the SQLite DB
# via WAL mode and claims jobs from the queue. Crashes are self-
# contained: if it dies, it goes into the logs and the API keeps
# serving. We deliberately DO NOT install a `wait -n` / cleanup trap
# — that pattern takes the whole container down on any sibling death
# and broke Railway healthchecks.

log() { echo "[start.sh] $*"; }

log "launching jobs worker"
node --import tsx/esm src/worker/index.ts &

log "launching API (foreground) — PORT=${PORT:-3000}"
exec node --import tsx/esm src/api/server.ts
