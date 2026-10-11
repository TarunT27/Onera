/** Lists messages in the code that a language has no translation for: `npx tsx scripts/i18n-missing.ts es`. */
import { loadDictionary } from "../lib/i18n/load";
import type { LocaleCode } from "../lib/i18n/languages";
import { uniqueKeys } from "./i18n-keys";

async function main() {
  const code = (process.argv[2] ?? "es") as LocaleCode;
  const dict = (await loadDictionary(code)) ?? {};
  const missing = uniqueKeys().filter((k) => !(k.key in dict));
  process.stdout.write(JSON.stringify(missing, null, 1) + "\n");
  process.stderr.write(`${missing.length} missing in ${code}\n`);
}
void main();
