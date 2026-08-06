/**
 * Telegram Bot Test Suite Runner
 */
import('./test-telegram-bot.mjs').catch(err => {
    console.error("Test Suite failed to launch:", err);
    process.exit(1);
});
