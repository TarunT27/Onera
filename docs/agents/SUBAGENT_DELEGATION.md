# Subagent delegation guide

Use subagents for bounded, independent work. The primary agent owns architecture, the shared contract, integration, final verification, security-sensitive decisions and external side effects (pushes, messages, deploys).

*Adapted from the team's original guide with lessons from building this repo. Additions are marked **(new)**.*

## When to delegate

Delegate work that has:

- A clear, limited objective
- Defined file ownership or a read-only scope
- Independent acceptance criteria
- No need for product, security, financial, deployment or external-impact decisions

Keep these with the primary agent: cross-module design, shared types and schema, production changes, secrets, data migrations, long-running servers, external messages, destructive operations, and final verification.

## Contract first, then fan out (new)

Parallel writers collide on shared files. Before spawning parallel agents, the primary agent:

1. Freezes the shared contract: types, schema registration hooks, public function signatures, route paths. In this repo that means `lib/types.ts`, `lib/db/modules.ts`, each `lib/<module>/index.ts` and [docs/BACKEND_PLAN.md](../BACKEND_PLAN.md).
2. Creates placeholder implementations for every cross-module function, so each agent compiles against the others before they exist.
3. Commits the contract, then gives each agent an isolated worktree branched from that commit.

Agents call other modules only through those public surfaces. Wiring they can't do inside their scope becomes a `TODO(wire):` note in their report.

## Required brief

Every assignment includes:

- **Owner:** the subagent's responsibility
- **Objective:** the concrete result required
- **Scope:** exact files, directories or read-only surfaces
- **Forbidden actions:** files not to change and actions not to take
- **Collaboration note:** other agents may be editing; never revert, reset, stash, clean or overwrite unrelated work
- **Permissions:** file writes, network, external models, external services
- **Runtime limits (new):** servers, ports, databases and processes the agent may use
- **Project invariants (new):** link [AGENTS.md](../../AGENTS.md) and restate the ones the task could break
- **Evidence required:** tests, commands, artifacts or findings to return
- **Stop conditions (new):** when to stop and report instead of widening scope
- **Merge gate:** the primary agent independently reviews before accepting the work

## Assignment template

```text
Owner: [agent name or role]

Objective:
[One concrete outcome.]

Scope:
- Owns: [exact files/directories]
- May change: [exact files]
- Must not change: [files/modules owned by others, shared contract files]
- Public surfaces it may call: [e.g. "@/lib/markets" getPortfolio]

Constraints:
- Other agents are working in parallel. Preserve their edits.
- Do not run git reset, checkout, clean, stash, or revert unrelated work.
- Do not change the shared contract. If it's wrong, stop and report.
- Do not expand scope; report blockers.

Permissions:
- File writes: [yes/no, where]
- Git: [commit on your worktree branch only / none]. Never push or touch main.
- Network: [yes/no]
- External model use: [yes/no]
- External side effects: [none / explicit list]

Runtime limits:
- Dev servers: [none / one, on port N, stopped before reporting]
- Database: [in-memory test DBs only / named scratch file]. Never write the shared demo DB.
- Background processes: stop everything you started before reporting.

Invariants (from AGENTS.md):
- [List the ones this task touches.]

Required evidence:
- Changed files
- Assumptions
- Commands and tests run, with results
- Failures, unverified areas, TODO(wire) items

Acceptance criteria:
1. [Observable criterion]
2. [Observable criterion]

Stop conditions:
- [e.g. the contract signature doesn't fit; a core file needs changing; tests outside your scope fail]

Merge gate:
Return a commit on your branch plus the report. The primary agent will inspect the diff,
re-run verification, and decide whether to integrate.
```

## Parallel work rules

- Give parallel writers disjoint file ownership **and** separate git worktrees. **(new)**
- In a fresh worktree, link dependencies instead of reinstalling: `ln -s <repo>/node_modules node_modules`. **(new)**
- Don't start long-running servers. Next.js 16 allows one `next dev` per project directory; a subagent's server once blocked the main app from starting. If a server is truly needed, assign a port and require it to be stopped before reporting. **(new)**
- Never share mutable state between agents: tests use in-memory databases, scratch files go in the agent's own directory. **(new)**
- Use read-only agents freely for separate investigations.
- Keep dependent edits sequential.
- Don't let one agent's test result validate another agent's code.
- Treat subagent output as a draft until independently reviewed.

## Merge checklist for the primary agent (new)

1. Read the diff; confirm it stays inside the assigned scope.
2. Check invariants: session-scoped queries, integer money, no new privileged AI or agent tools, writes only through the governed lifecycle.
3. Merge branches one at a time; run `npm run typecheck` and `npm test` after each.
4. Do the `TODO(wire)` integration yourself, with tests.
5. Run the app and click through the affected flows.
6. Make sure no secrets or local databases are staged.
7. Commit and push only with the user's authorization.
