/** Errors raised inside agent runs. Both are permanent: the job is dead-lettered, not retried. */

/** An agent tried to read or write outside its registered scope. Audited as "agent.scope_violation". */
export class ScopeViolationError extends Error {
  constructor(
    public scope: string,
    message?: string,
    public agentId?: string,
  ) {
    super(message ?? `Agent ${agentId ?? "(unknown)"} is not permitted to access "${scope}"`);
    this.name = "ScopeViolationError";
  }
}

/** The job can never succeed (bad payload, record not found for this user). No retry. */
export class PermanentJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentJobError";
  }
}
