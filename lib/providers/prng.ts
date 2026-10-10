/**
 * Deterministic pseudo-randomness for the simulated connectors. Never use
 * Math.random here: the same user, institution and day must always produce the
 * same synthetic history, so syncs are reproducible and idempotent.
 */

/** FNV-1a 32-bit hash of a string. */
export function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 PRNG: returns a generator of floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * A single deterministic draw in [0, 1) keyed by its parts. Order-independent:
 * each (key) gets its own seeded stream, so adding a draw elsewhere never
 * shifts unrelated values.
 */
export function draw(...parts: (string | number)[]): number {
  return mulberry32(fnv1a(parts.join("|")))();
}

/** Deterministic integer in [min, max] (inclusive). */
export function drawInt(min: number, max: number, ...parts: (string | number)[]): number {
  return min + Math.floor(draw(...parts) * (max - min + 1));
}
