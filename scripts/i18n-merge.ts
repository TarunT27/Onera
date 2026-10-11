/**
 * Merges translated chunk files into lib/i18n/locales/<code>.ts.
 *   npx tsx scripts/i18n-merge.ts <code> <dir>
 * <dir> holds <code>.<n>.json files: { "English key": "translation" | { one, other, … } }.
 * Refuses to write if a message is missing or a placeholder does not match.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LANGUAGES } from "../lib/i18n/languages";
import { loadDictionary } from "../lib/i18n/load";
import { uniqueKeys } from "./i18n-keys";

const [code, dir] = process.argv.slice(2);
const language = LANGUAGES.find((l) => l.code === code);
if (!language || !dir) {
  console.error("usage: i18n-merge.ts <code> <dir>");
  process.exit(2);
}
async function main() {
// Start from what is already in the locale file so new messages can be added in a small extra chunk.
const existing = ((await loadDictionary(language!.code)) ?? {}) as Record<string, unknown>;
const merged: Record<string, unknown> = { ...existing };
for (const file of readdirSync(dir).filter((f) => f.startsWith(`${code}.`) && f.endsWith(".json")).sort()) {
  Object.assign(merged, JSON.parse(readFileSync(join(dir, file), "utf8")));
}
const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
const categories = new Intl.PluralRules(language!.intl).resolvedOptions().pluralCategories as string[];
const problems: string[] = [];
const out: Record<string, unknown> = {};
for (const { key, plural } of uniqueKeys()) {
  const value = merged[key];
  if (value === undefined || value === "") { problems.push(`missing: ${key}`); continue; }
  const forms = typeof value === "string" ? [value] : Object.values(value as Record<string, string>);
  if (plural && typeof value === "string" && categories.length > 1) problems.push(`plural key needs forms ${categories.join("/")}: ${key}`);
  if (plural && typeof value !== "string") {
    for (const c of categories) if (!(value as Record<string, string>)[c]) problems.push(`missing plural form ${c}: ${key}`);
  }
  for (const form of forms) {
    const want = ph(key);
    if (ph(form) !== want) problems.push(`placeholder mismatch: ${key} → ${form}`);
  }
  out[key] = value;
}
if (problems.length) {
  console.error(problems.slice(0, 40).join("\n"));
  console.error(`${problems.length} problem(s); nothing written`);
  process.exit(1);
}
const body = JSON.stringify(out, null, 2);
writeFileSync(
  join("lib/i18n/locales", `${code}.ts`),
  `import type { Dictionary } from "../translate";\n\n// ${language!.english}. Keys are the English UI text; \`npm test\` checks every message is covered.\nconst dictionary: Dictionary = ${body};\n\nexport default dictionary;\n`,
);
console.log(`${code}: wrote ${Object.keys(out).length} messages`);
}
void main();
