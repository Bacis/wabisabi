// MUST be the first import. See src/env.ts — without this, any module-
// init env var read (TELEGRAM_BOT_TOKEN in bot.ts, PORT, etc.) happens
// before process.loadEnvFile() and silently falls back to defaults.
import '../env.js';

import { bot } from './bot.js';

// Telegram returns 409 when two processes call `getUpdates` on the same
// token. This happens during Railway rolling deploys (old container still
// polling when the new one starts) and resolves once the old instance
// drains. Retry on 409 instead of crashing so the container survives
// deploy overlap.
const CONFLICT_RETRY_MS = 15_000;
const MAX_CONFLICT_RETRIES = 20; // ~5 min of overlap tolerance

function isConflict(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const response = (err as { response?: { error_code?: number } }).response;
  return response?.error_code === 409;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  // Long-polling mode. No public URL required.
  //
  // In Telegraf 4, `bot.launch()` does not resolve in polling mode — it
  // returns only when polling stops. The `onLaunch` callback fires after
  // `getMe` succeeds and before the polling loop begins, which is the
  // right moment to confirm the connection.
  let attempt = 0;
  while (true) {
    attempt++;
    try {
      await bot.launch({ dropPendingUpdates: true }, () => {
        console.log(
          `telegram: bot launched as @${bot.botInfo?.username ?? 'unknown'}` +
            (attempt > 1 ? ` (attempt ${attempt})` : ''),
        );
      });
      // launch() only returns when bot.stop() was called — clean exit.
      console.log('telegram: polling stopped, shutting down');
      return;
    } catch (err) {
      if (isConflict(err) && attempt < MAX_CONFLICT_RETRIES) {
        console.warn(
          `telegram: 409 conflict (another instance polling). ` +
            `Retrying in ${CONFLICT_RETRY_MS / 1000}s (attempt ${attempt}/${MAX_CONFLICT_RETRIES})...`,
        );
        await sleep(CONFLICT_RETRY_MS);
        continue;
      }
      throw err;
    }
  }
}

// Graceful shutdown so Railway's SIGTERM on redeploy drains cleanly.
const stop = (signal: string) => {
  console.log(`telegram: received ${signal}, stopping...`);
  bot.stop(signal);
};
process.once('SIGINT', () => stop('SIGINT'));
process.once('SIGTERM', () => stop('SIGTERM'));

main().catch((err) => {
  console.error('telegram: failed to launch', err);
  process.exit(1);
});
