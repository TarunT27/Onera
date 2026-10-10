# Onera — submission draft (HackRU Fall 2026)

*Draft for Person 3 to edit. Check the organizers' actual submission requirements before posting. Verify every claim against [FEATURES.md](FEATURES.md).*

## One-liner

Onera puts all your accounts in one place and gives AI useful work to do, with explicit limits on every action.

## Inspiration

Money is spread across banks, cards, brokerages and accounts abroad. AI assistants could simplify it, but nobody should hand an AI the ability to move their money without controls they can see and verify.

## What it does

- **One hub:** balances, net worth across currencies, spending and subscriptions across simulated bank connections (TD Bank, Bank of America, JPMorgan Chase, Barclays UK, RBC — all simulated).
- **Ask Onera:** a Claude-powered assistant that reads your data, explains it with evidence, and drafts transfers. It cannot approve or execute anything.
- **Background AI agents:** monitor spending spikes, subscription price increases, risky transfers, portfolio concentration and connection health, and raise findings that cite their evidence.
- **Governance that's enforced, not promised:** every transfer or paper trade goes through deterministic policy checks and your approval of the exact version. A changed recipient, an exceeded limit or a pause holds it. A malicious instruction hidden in an article can't get past the server.

## How we built it

Next.js 16, React 19, TypeScript, Tailwind, SQLite (better-sqlite3), Claude API (`claude-opus-5-5`) with tool use, Vitest and Playwright. Built with help from Claude, Codex and Gemini as coding assistants.

Architecture: one Next.js app with module boundaries — core governance (policy, approval hashing, atomic simulator, audit), providers (simulated bank connectors with idempotent cursor sync), markets (simulated quotes, paper orders, mandates) and agents (durable job queue, worker, permission registry enforced in code).

## Challenges

- Making approvals bind to the exact transfer, so any later edit, recipient change or pause invalidates them.
- Guaranteeing a transfer executes once even under repeated or concurrent requests.
- Giving AI agents real work while making it structurally impossible for them to approve or execute.

## Accomplishments

- Over 140 automated tests covering the acceptance checks: ownership isolation, holds, bound approvals, duplicate protection, pause, injection boundary, and the sync and agent engines.
- The signature demo: a rent payment to a landlord whose bank details changed after a "new payment instructions" email is held, and neither the UI, a direct API call, nor the AI can force it through.

## What we learned

Prompts aren't controls. The model can be helpful, but authority over money has to live in deterministic server code with an audit trail.

## What's next

Real aggregation and payment partners behind the same interfaces, licensed market data, production authentication, and a trading/research workspace. See [ROADMAP.md](ROADMAP.md).

## Limitations (state these honestly)

All data and money movement are synthetic or simulated. The user switcher is a demo mechanism, not authentication. Tests show these specific scenarios are blocked; they don't establish production fraud detection or complete prompt-injection immunity.

## Demo script (3 minutes)

1. Hub with simulated linked banks and net worth (synthetic disclosure).
2. "What changed in my spending?" → StreamFlix $15.49 → $22.99 with evidence; AI monitoring panel findings.
3. "Pay Oak Street Properties $1,850" → held for changed recipient; "Try to execute anyway" → refused.
4. $500 to savings → approve exact version → execute → execute again shows no duplicate.
5. Pause in Control, audit trail, agent permission matrix. Close: "The AI helps you decide. Your permissions determine what it can do."
