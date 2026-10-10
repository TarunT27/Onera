# Subagent Delegation Guide

Use subagents for bounded, independent work. The primary agent owns architecture, integration, final verification, security-sensitive decisions, Git coordination, and external side effects.

## Current Authority and Ownership

For this build, follow the updated `CONTEXT.md` and `Team Roles and Delivery Plan.md` role split when older planning or the checked-in README disagrees.

The primary agent is **Person 1 — Product Engineer, Frontend and AI Experience**:

- Owns UI pages and components under `app/`.
- Owns `lib/ai/` and `app/api/chat/route.ts`.
- Integrates the complete browser journey against real server responses.
- Does not independently change Person 2's financial contracts, database, policy, action service, simulator, seed data, or financial API routes.

Person 2 owns `lib/types.ts`, `lib/db/`, `lib/finance/`, `lib/policy/`, `lib/actions/`, `lib/controls.ts`, `fixtures/seed-data.ts`, and financial API routes. Person 3 supplies product priorities and copy. Person 4 supplies governance requirements, fixtures, expected outcomes, and evaluation findings. Changes outside Person 1's ownership require the relevant owner's handoff or review.

All agents must preserve the ClearFi invariants in `AGENTS.md`, especially server-owned user identity, integer-cent USD amounts, exact-version approval, deterministic policy, simulated/synthetic labels, and the AI tool boundary.

## When to Delegate

Delegate work that has:

- A clear, limited objective
- Defined file ownership or a read-only scope
- Independent acceptance criteria
- No need for product, security, financial, deployment, or external-impact decisions

Keep cross-module design, production changes, secrets, data migrations, service restarts, external messages, destructive operations, and final verification with the primary agent.

Prefer the smallest useful delegation:

1. **Read-only scout:** inspect a narrow surface and return file/line findings. Use this before assigning uncertain implementation work.
2. **Bounded implementer:** change one cohesive behavior in disjoint files, normally no more than three files.
3. **Read-only verifier:** inspect or test completed work without editing it. A verifier must not validate code it authored.

Do not delegate a task when briefing and reviewing it would cost more than doing the small change directly. Do not ask several agents to inspect the same files or answer the same question.

## Token-Efficient Context

- The primary agent reads the governing project documents and makes scope decisions.
- Every implementation agent reads `AGENTS.md`, but receives only the relevant role, contract, file paths, and acceptance criteria from the primary agent. Do not ask it to reread all planning documents.
- Point agents to exact symbols or line ranges when known. Avoid broad requests such as "review the frontend" or "understand the repo."
- Ask for concise evidence, not a narrative: changed files, key decisions, commands, results, and blockers.
- Do not paste full source files into assignments or returns. Refer to repository paths and summarize only the contract needed for the task.
- Reuse one scout's findings in later briefs instead of paying multiple agents to rediscover the same context.

### Usage-limit discipline

- When the user asks to conserve usage, work in the primary agent by default. Delegate only when an independent task clearly saves total work; do not launch a new review wave for small edits.
- Batch independent reads, cap command output, and keep browser checks focused on changed behavior. Reuse verified contracts and completed findings.
- Run the required integrated checks once per completed change set. Repeat only the affected check after a new edit or failure; do not rerun successful checks without a reason.
- Stop at a verified, documented handoff. Defer optional stretch work and additional research until requested.

## Required Subagent Brief

Every assignment must include:

- **Owner:** the subagent's responsibility
- **Objective:** the concrete result required
- **Scope:** exact files, directories, or read-only surfaces
- **Forbidden actions:** files not to change and actions not to take
- **Collaboration note:** other agents may be editing; never revert, reset, stash, clean, or overwrite unrelated work
- **Permissions:** whether file writes, network access, external models, or external services are allowed
- **Evidence required:** tests, commands, screenshots, artifacts, or findings to return
- **Merge gate:** the primary agent independently reviews before accepting the work
- **Base state:** current branch and starting commit, so concurrent updates are detectable

## Assignment Template

```text
Owner: [agent name or role]

Objective:
[One concrete outcome.]

Scope:
- Owns: [exact files/directories/read-only surfaces]
- May change: [exact files]
- Must not change: [files/modules owned by others]
- Base state: [branch and starting commit]

Constraints:
- Other agents are working in this repository. Preserve their edits.
- Do not run git commit, pull, push, merge, rebase, reset, checkout, clean, stash,
  or revert. Git integration belongs to the primary agent.
- Do not make external changes unless explicitly authorized below.
- Do not expand scope without reporting the blocker.
- Read `AGENTS.md` before editing and obey its invariants.

Permissions:
- File writes: [yes/no, where]
- Network access: [yes/no]
- External model use: [yes/no]
- External side effects: [none / explicitly listed actions]

Required evidence:
- Changed files:
- Assumptions:
- Commands and tests run:
- Results:
- Failures or unverified areas:
- Unexpected pre-existing or concurrent changes:

Acceptance criteria:
1. [Observable criterion]
2. [Observable criterion]

Merge gate:
Return findings or a patch. The primary agent will independently inspect the work,
review tests, run appropriate verification, and decide whether to integrate it.
```

## Parallel Work Rules

- Assign disjoint file ownership for parallel writes.
- Use read-only agents for separate investigations only when their value exceeds the briefing and review cost; respect the usage-limit discipline above.
- Keep dependent edits sequential.
- Do not let one agent's test result validate another agent's code.
- Treat subagent output as a draft until independently reviewed.
- Never let subagents commit, pull, push, merge, rebase, or rewrite repository history.
- Record `git status --short --branch` and `git rev-parse HEAD` before each work wave.
- If the base commit changes during a wave, review the incoming diff before integrating returned work.
- Before accepting a patch, inspect `git diff -- <owned paths>` and confirm that only assigned files changed.
- Pull shared changes only from a known local state. Never use reset, clean, or an automatic stash to make a pull succeed.

## Person 1 Work Waves

Use sequential waves so contracts settle before UI integration:

1. **Contract scan:** one read-only scout inspects Person 2's API/types and reports the exact request/response shapes Person 1 needs. No writes.
2. **Disjoint build:** parallelize only independent Person 1 surfaces, such as one UI page/component group and one `lib/ai/` task. Never assign overlapping files.
3. **Integration:** the primary agent connects the browser journey, resolves contract mismatches with Person 2, and handles shared files.
4. **Verification:** use read-only QA for targeted browser/code inspection; the primary agent then runs typecheck, tests, and the complete demo flow.

For the current MVP, preserve this dependency order:

`stable financial contract -> UI data wiring -> transfer review/approval flow -> chat tools -> polish and fallback states`

Do not parallelize a downstream step before its contract is stable. If the valid and held transfer paths are incomplete, defer research, portfolio, and cosmetic stretch work.

## Primary-Agent Merge Gate

Before any commit or push, the primary agent must:

1. Fetch or pull carefully and inspect concurrent team changes.
2. Review every returned diff against its assigned scope and the current `HEAD`.
3. Resolve ownership or contract conflicts with the responsible teammate rather than silently editing their files.
4. Run the narrow checks for each change, then `npm run typecheck`, `npm test`, and `git diff --check` for the integrated result.
5. Confirm synthetic/simulated/fallback labels and the AI no-approve/no-execute boundary remain intact.
6. Commit a small cohesive unit and push only when explicitly requested or already agreed by the team.
