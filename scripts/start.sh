#!/bin/sh
set -e

# Start the background workers, the API server, and the Telegram bot
# side by side. All four share the same SQLite database on disk. The
# jobs worker claims single-video caption jobs; the producer worker
# claims multi-file video producer jobs; the Telegram bot exposes the
# producer flow over Telegram. Each loop is tiny and runs concurrently.

node --import tsx/esm src/worker/index.ts &
WORKER_PID=$!

node --import tsx/esm src/worker/producerIndex.ts &
PRODUCER_PID=$!

node --import tsx/esm src/api/server.ts &
API_PID=$!

# Telegram bot is optional — only start it if a token is set. Without
# the token, Telegraf throws at module load and the container would
# restart-loop, which isn't what we want for deployments that don't
# use the bot.
if [ -n "$TELEGRAM_BOT_TOKEN" ]; then
  node --import tsx/esm src/telegram/index.ts &
  TELEGRAM_PID=$!
fi

# Forward termination signals so Railway's graceful shutdown works.
cleanup() {
  kill "$WORKER_PID" "$PRODUCER_PID" "$API_PID" ${TELEGRAM_PID:-} 2>/dev/null || true
  wait "$WORKER_PID" "$PRODUCER_PID" "$API_PID" ${TELEGRAM_PID:-} 2>/dev/null || true
}
trap cleanup SIGTERM SIGINT

# Wait for any process to exit. If one dies, bring down the others so
# Railway restarts the whole container.
wait -n "$WORKER_PID" "$PRODUCER_PID" "$API_PID" ${TELEGRAM_PID:-} 2>/dev/null || true
cleanup
exit 1
