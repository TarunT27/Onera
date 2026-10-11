/**
 * Marks an English string for translation without translating it yet. Use it
 * for module-level constants (labels, option lists) and render them later
 * with `t(value)`. The extractor treats `msg("…")` like `t("…")`.
 */
export const msg = <T extends string>(text: T): T => text;
