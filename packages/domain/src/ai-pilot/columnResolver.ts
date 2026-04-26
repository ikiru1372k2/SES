const normalize = (s: string): string =>
  s.toLowerCase().replace(/[\s_\-./]+/g, '').replace(/[^a-z0-9]/g, '');

export class ColumnResolver {
  private readonly map = new Map<string, string>();
  private readonly originals: string[];

  constructor(headers: readonly string[]) {
    this.originals = [...headers];
    for (const h of headers) {
      this.map.set(normalize(h), h);
    }
  }

  resolve(label: string): string | undefined {
    if (!label) return undefined;
    return this.map.get(normalize(label));
  }

  suggest(label: string, max = 3): string[] {
    if (!label) return [];
    const target = normalize(label);
    if (!target) return [];
    return [...this.originals]
      .map((h) => ({ h, score: similarity(target, normalize(h)) }))
      .filter((x) => x.score > 0.4)
      .sort((a, b) => b.score - a.score)
      .slice(0, max)
      .map((x) => x.h);
  }
}

function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const longer = a.length >= b.length ? a : b;
  const shorter = a.length >= b.length ? b : a;
  if (longer.includes(shorter)) return shorter.length / longer.length;
  const dist = levenshtein(a, b);
  return 1 - dist / Math.max(a.length, b.length);
}

function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i]![0] = i;
  for (let j = 0; j <= b.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + cost);
    }
  }
  return dp[a.length]![b.length]!;
}
