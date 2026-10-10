// Background agents stay advisory: they must never reach order execution,
// approvals, mandate management, controls or transfer execution, even indirectly.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const FORBIDDEN = [
  "executeOrder", "approveOrder", "createMandate", "revokeMandate", "updateTradingControls",
  "executeTransfer", "approveAction", "updateControls", "verifyRecipient",
];

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? sources(p) : p.endsWith(".ts") ? [p] : [];
  });
}

describe("agents import boundary", () => {
  it("lib/agents never references privileged execution, approval, mandate or control functions", () => {
    const offenders = sources(path.join(process.cwd(), "lib", "agents")).flatMap((file) => {
      const text = fs.readFileSync(file, "utf8");
      return FORBIDDEN.filter((name) => new RegExp(`\\b${name}\\b`).test(text)).map((name) => `${path.basename(file)}: ${name}`);
    });
    expect(offenders).toEqual([]);
  });
});
