# Agent permissions

Deterministic, session-scoped demo monitors. No approval, execution, verification or control privileges.

| Agent | Job types | read accounts | read transactions | read recipients | read actions | read portfolio | read connections | read audit | write insights | write jobs | write connection_sync | approve | execute | mandates | verify recipients | change controls | model |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Spending monitor (`spending_monitor`) | `spending_review` | — | yes | — | — | — | — | — | yes | — | — | never | never | never | never | never | none |
| Subscription monitor (`subscription_monitor`) | `subscription_review` | — | yes | — | — | — | — | — | yes | — | — | never | never | never | never | never | none |
| Security sentinel (`security_sentinel`) | `security_review` | — | yes | yes | yes | — | — | — | yes | — | — | never | never | never | never | never | none |
| Portfolio monitor (`portfolio_monitor`) | `portfolio_review` | — | — | — | — | yes | — | — | yes | — | — | never | never | never | never | never | none |
| Connection monitor (`connection_monitor`) | `sync_connection` | — | — | — | — | — | yes | — | yes | yes | yes | never | never | never | never | never | none |
| Threat monitor (`threat_monitor`) | `threat_sweep` | — | — | — | yes | — | — | yes | yes | — | — | never | never | never | never | never | none |
| Personal assistant (`personal_assistant`) | `assistant_briefing` | yes | yes | — | yes | yes | yes | — | yes | — | — | never | never | never | never | never | none |

## Running the worker

The background worker runs the monitors asynchronously. Each tick schedules every user's recurring jobs (daily reviews; a connection sync every 15 minutes per healthy connection, deduped per day/bucket; a personal-assistant briefing every 30 minutes; a threat sweep whenever new activity reaches the user's audit log, deduped per latest audit event) and then runs due jobs. Every job still runs scoped to its own user and is audited as `agent:<id>`.

```bash
npm run worker                    # loop: tick every 5 s until Ctrl-C
npm run worker -- --once          # one tick, then exit (0 on success, 1 if the tick threw)
npm run worker -- --limit 50      # max jobs per tick (default 25)
```

| Env var | Default | Meaning |
| --- | --- | --- |
| `CLEARFI_DB_PATH` | `./data/clearfi.db` | SQLite file (shared with the Next.js server) |
| `CLEARFI_WORKER_INTERVAL_MS` | `5000` | Sleep between ticks |

Each tick logs one line: `scheduled`, `deduped`, `processed`, `succeeded`, `failed`, `dead`. A tick that throws is logged and the loop continues. SIGINT/SIGTERM lets the current tick finish, closes the database and exits; a second signal exits immediately. Crashed workers are safe: leased jobs are requeued when the lease expires.

The worker is optional for the demo. The demo endpoint `POST /api/agents/run` (for a "run agents now" button) does one bounded tick (up to 50 jobs) synchronously for the session user only.
