/** Number dressing for the instruments. */

export function money(amount: number): string {
  const sign = amount < 0 ? "−" : "";
  return `${sign}$${Math.abs(Math.round(amount)).toLocaleString("en-US")}`;
}

/** Compact money for tight instruments: $2.4M, $310k. */
export function moneyShort(amount: number): string {
  const sign = amount < 0 ? "−" : "";
  const abs = Math.abs(amount);
  if (abs >= 10_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 10_000) return `${sign}$${Math.round(abs / 1000)}k`;
  return `${sign}$${Math.round(abs).toLocaleString("en-US")}`;
}

export function tons(value: number): string {
  return `${Math.round(value).toLocaleString("en-US")}t`;
}

export function nm(value: number): string {
  return `${Math.round(value).toLocaleString("en-US")} nm`;
}

export function knots(value: number): string {
  return `${value % 1 === 0 ? value : value.toFixed(1)} kn`;
}

export function days(value: number): string {
  return `${value} ${value === 1 ? "day" : "days"}`;
}
