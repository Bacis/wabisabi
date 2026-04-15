// MUST be the first import. See src/env.ts — without this, any module-
// init env var read (TELEGRAM_BOT_TOKEN in bot.ts, PORT, etc.) happens
// before process.loadEnvFile() and silently falls back to defaults.
import '../env.js';

import { bot } from './bot.js';

async function main(): Promise<void> {
  // Long-polling mode. No public URL required.
  //
  // In Telegraf 4, `bot.launch()` does not resolve in polling mode — it
  // returns only when polling stops. The `onLaunch` callback fires after
  // `getMe` succeeds and before the polling loop begins, which is the
  // right moment to confirm the connection.
  await bot.launch({ dropPendingUpdates: true }, () => {
    console.log(`telegram: bot launched as @${bot.botInfo?.username ?? 'unknown'}`);
  });
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
