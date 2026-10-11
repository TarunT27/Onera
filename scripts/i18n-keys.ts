/**
 * Finds every translatable message in the source by reading the code, so the
 * dictionaries can be checked for gaps. Recognised calls:
 *   t("…")  tr("…", {…})  msg("…")  tpl("…", {…})  → key is the first argument
 *   tp(n, "one", "other")                → key is "other" (third argument)
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

export type SourceKey = { key: string; plural: boolean; file: string; line: number };

const ROOTS = ["app", "lib"];
const SKIP = new Set(["node_modules", ".next", "locales"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

function literal(node: ts.Node | undefined): string | null {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  // "a" + "b" concatenation of literals
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const l = literal(node.left);
    const r = literal(node.right);
    return l !== null && r !== null ? l + r : null;
  }
  return null;
}

export function collectKeys(root = process.cwd()): SourceKey[] {
  const found: SourceKey[] = [];
  for (const base of ROOTS) {
    for (const file of walk(join(root, base))) {
      const text = readFileSync(file, "utf8");
      if (!/\b(t|tr|tp|msg|tpl)\(/.test(text)) continue;
      const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node)) {
          const callee = ts.isIdentifier(node.expression)
            ? node.expression.text
            : ts.isPropertyAccessExpression(node.expression)
              ? node.expression.name.text
              : "";
          const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
          const rel = file.slice(root.length + 1);
          if (callee === "t" || callee === "tr" || callee === "msg" || callee === "tpl") {
            const key = literal(node.arguments[0]);
            if (key) found.push({ key, plural: false, file: rel, line });
          } else if (callee === "tp") {
            const key = literal(node.arguments[2]);
            if (key) found.push({ key, plural: true, file: rel, line });
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  }
  return found;
}

/** Unique keys, plural flag merged, in first-seen order. */
export function uniqueKeys(keys = collectKeys()): { key: string; plural: boolean }[] {
  const map = new Map<string, boolean>();
  for (const k of keys) map.set(k.key, (map.get(k.key) ?? false) || k.plural);
  return [...map].map(([key, plural]) => ({ key, plural }));
}

if (process.argv[1]?.endsWith("i18n-keys.ts")) {
  if (process.argv.includes("--where")) {
    // One line per use: handy for checking what a file contributes.
    for (const k of collectKeys()) process.stdout.write(`${k.file}:${k.line}\t${k.plural ? "[plural] " : ""}${k.key}\n`);
  } else {
    const keys = uniqueKeys();
    process.stdout.write(JSON.stringify(keys, null, 2) + "\n");
    process.stderr.write(`${keys.length} messages\n`);
  }
}
