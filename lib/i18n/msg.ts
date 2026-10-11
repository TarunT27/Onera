/**
 * Marks an English string for translation without translating it yet. Use it
 * for module-level constants (labels, option lists) and render them later
 * with `t(value)`. The extractor treats `msg("…")` like `t("…")`.
 */
export const msg = <T extends string>(text: T): T => text;

/**
 * Builds a sentence from a template: `tpl("{name} paid {amount}", { name, amount })`.
 * The output is plain English, exactly like a template literal, but the
 * template is registered for translation, and the UI can match the finished
 * sentence back to it. Use it wherever the server writes text that people read.
 */
export function tpl(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}
