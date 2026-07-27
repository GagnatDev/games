/**
 * Deterministic randomness for Landfall.
 *
 * Every roll the game makes goes through a `Dice` whose integer state lives in
 * the save document, so a voyage resumed on another device meets exactly the
 * same seas. Derived seeds (`hashSeed`) give each port's daily freight market a
 * reproducible offer list without storing the offers themselves.
 */

/** mulberry32 — small, fast, and good enough for weather. */
export class Dice {
  private s: number;

  constructor(state: number) {
    this.s = state >>> 0;
  }

  /** The integer to persist so the next session continues the same stream. */
  get state(): number {
    return this.s;
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [min, max], inclusive on both ends. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Uniform in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.min(items.length - 1, Math.floor(this.next() * items.length))]!;
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }
}

/** FNV-1a over the parts — one stable seed per (seed, port, day, …) tuple. */
export function hashSeed(...parts: readonly (number | string)[]): number {
  let hash = 0x811c9dc5;
  for (const part of parts) {
    const text = String(part);
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    hash ^= 0x7c;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}
