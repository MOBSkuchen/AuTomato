# cron

Trigger module. `on_tick` returns the current UTC timestamp every `$CRON_INTERVAL_MS` (default 1000ms).

Trigger style: **polling**. Compiled workflows wrap this in a `for { ... }` loop.
