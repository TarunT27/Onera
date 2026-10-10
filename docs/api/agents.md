# Agent permissions

Deterministic, session-scoped demo monitors. No approval, execution, verification or control privileges.

| Agent | Job types | read accounts | read transactions | read recipients | read actions | read portfolio | read connections | write insights | write jobs | write connection_sync | approve | execute | mandates | verify recipients | change controls | model |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Spending monitor (`spending_monitor`) | `spending_review` | — | yes | — | — | — | — | yes | — | — | never | never | never | never | never | none |
| Subscription monitor (`subscription_monitor`) | `subscription_review` | — | yes | — | — | — | — | yes | — | — | never | never | never | never | never | none |
| Security sentinel (`security_sentinel`) | `security_review` | — | yes | yes | yes | — | — | yes | — | — | never | never | never | never | never | none |
| Portfolio monitor (`portfolio_monitor`) | `portfolio_review` | — | — | — | — | yes | — | yes | — | — | never | never | never | never | never | none |
| Connection monitor (`connection_monitor`) | `sync_connection` | — | — | — | — | — | yes | yes | yes | yes | never | never | never | never | never | none |
