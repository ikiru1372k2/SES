import { token_sort_ratio } from 'fuzzball';
import { sanitizeHeader } from '@ses/domain';

export const DIRECTORY_RATIO_AUTO = 90;
export const DIRECTORY_RATIO_CANDIDATE_MIN = 70;
export const DIRECTORY_TIE_DELTA = 5;

function parseAliases(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((x): x is string => typeof x === 'string');
}

export type DirectoryMatchEntry = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  normalizedKey: string;
  aliases: unknown;
  active: boolean;
};

export function matchRawNameToDirectoryEntries(
  rawName: string,
  entries: DirectoryMatchEntry[],
): {
  autoMatch: { id: string; email: string; score: number } | null;
  candidates: Array<{ id: string; email: string; score: number }>;
  collision: boolean;
} {
  const needle = sanitizeHeader(rawName).trim().toLowerCase();
  if (!needle) {
    return { autoMatch: null, candidates: [], collision: false };
  }
  const scored: Array<{ id: string; email: string; score: number }> = [];
  for (const e of entries) {
    if (!e.active) continue;
    const display = `${e.firstName} ${e.lastName}`.trim().toLowerCase();
    const keyScore = token_sort_ratio(needle, e.normalizedKey);
    const nameScore = token_sort_ratio(needle, display);
    let best = Math.max(keyScore, nameScore);
    for (const a of parseAliases(e.aliases)) {
      best = Math.max(best, token_sort_ratio(needle, a.toLowerCase()));
    }
    if (best >= DIRECTORY_RATIO_CANDIDATE_MIN) {
      scored.push({ id: e.id, email: e.email, score: best });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  const top = scored[0];
  const second = scored[1];
  if (!top) {
    return { autoMatch: null, candidates: [], collision: false };
  }
  const collision =
    second !== undefined &&
    top.score >= DIRECTORY_RATIO_CANDIDATE_MIN &&
    second.score >= DIRECTORY_RATIO_CANDIDATE_MIN &&
    top.score - second.score <= DIRECTORY_TIE_DELTA &&
    top.email !== second.email;
  if (collision) {
    return { autoMatch: null, candidates: scored.slice(0, 8), collision: true };
  }
  const autoMatch =
    top.score >= DIRECTORY_RATIO_AUTO ? { id: top.id, email: top.email, score: top.score } : null;
  return { autoMatch, candidates: scored.slice(0, 8), collision: false };
}
