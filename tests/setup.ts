/**
 * Runs before every test file. Tests never talk to a real broker: Alpaca keys from the
 * developer's shell are removed, so the markets module runs in simulated mode unless a
 * test opts in with vi.stubEnv (and a stubbed fetch).
 */
for (const key of [
  "ALPACA_API_KEY_ID",
  "ALPACA_API_SECRET_KEY",
  "ALPACA_ENV",
  "ALPACA_ALLOW_LIVE_TRADING",
  "ALPACA_LIVE_MAX_ORDER_CENTS",
  "ALPACA_DATA_FEED",
  "ALPACA_USER_ID",
]) {
  delete process.env[key];
}
