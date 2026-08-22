// Deterministic local matcher for steel item names.
// The AI only has to OCR the text; matching happens here so it is fast,
// repeatable and not limited by prompt size.

export type MatchCatalogItem = {
  id: string;
  name: string;
  section?: string | null;
};

type Sig = {
  raw: string;
  norm: string;
  nums: number[];
  kg: number | null;
  mm: number | null;
  od: boolean;
  words: Set<string>;
};

const SYN: Record<string, string> = {
  CHANNEL: "C",
  CHNL: "C",
  ANGLE: "L",
  ANG: "L",
  SQUARE: "SQ",
  SQR: "SQ",
  RECT: "RECT",
  RECTANGULAR: "RECT",
  ROUND: "ROUND",
  PIPE: "PIPE",
  TUBE: "PIPE",
  PLT: "PLATE",
  PLATE: "PLATE",
  SHEET: "SHEET",
  BEAM: "BEAM",
  FLAT: "FLAT",
  PATTI: "FLAT",
};

function num(s: string): number {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : NaN;
}

export function signature(raw: string): Sig {
  const upper = (raw || "").toUpperCase().replace(/[×✕]/g, "X").replace(/,/g, "");
  // weight per piece e.g. (11 KG), 11KG, 11 KGS
  const kgM = upper.match(/(\d+(?:\.\d+)?)\s*KGS?\b/);
  const mmM = upper.match(/(\d+(?:\.\d+)?)\s*MM\b/);
  const od = /\bO\.?D\b/.test(upper);

  const norm = upper
    .replace(/\bO\.?D\b/g, " OD ")
    .replace(/[()\[\]{}]/g, " ")
    .replace(/[^A-Z0-9.X ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const nums = (norm.match(/\d+(?:\.\d+)?/g) ?? []).map(num).filter((n) => !Number.isNaN(n));

  const words = new Set<string>();
  for (const w of norm.split(/[ X]+/)) {
    if (!w || /^\d/.test(w)) continue;
    words.add(SYN[w] ?? w);
  }
  if (od) words.add("OD");

  return {
    raw,
    norm,
    nums,
    kg: kgM ? num(kgM[1]) : null,
    mm: mmM ? num(mmM[1]) : null,
    od,
    words,
  };
}

function numOverlap(a: number[], b: number[]): number {
  if (!a.length || !b.length) return 0;
  const pool = [...b];
  let hits = 0;
  for (const x of a) {
    const idx = pool.findIndex((y) => Math.abs(x - y) < 0.001 || (x !== 0 && Math.abs(x - y) / Math.max(x, y) < 0.02));
    if (idx >= 0) {
      pool.splice(idx, 1);
      hits++;
    }
  }
  return hits / Math.max(a.length, b.length);
}

function wordOverlap(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 0.5;
  let hits = 0;
  for (const w of a) if (b.has(w)) hits++;
  return hits / Math.max(a.size, b.size, 1);
}

export function scoreMatch(query: Sig, cand: Sig): number {
  let score = 0;
  score += numOverlap(query.nums, cand.nums) * 55;
  score += wordOverlap(query.words, cand.words) * 20;

  // weight-per-piece is the strongest discriminator on pipes
  if (query.kg != null && cand.kg != null) {
    score += Math.abs(query.kg - cand.kg) < 0.26 ? 18 : -14;
  }
  if (query.mm != null && cand.mm != null) {
    score += Math.abs(query.mm - cand.mm) < 0.06 ? 10 : -12;
  }
  if (query.od !== cand.od) score -= 8;

  // substring bonus (handles exact catalog names written verbatim)
  const a = query.norm.replace(/ /g, "");
  const b = cand.norm.replace(/ /g, "");
  if (a && b && (a.includes(b) || b.includes(a))) score += 12;

  return score;
}

export type MatcherIndex = { item: MatchCatalogItem; sig: Sig }[];

export function buildIndex(catalog: MatchCatalogItem[]): MatcherIndex {
  return catalog.map((item) => ({
    item,
    sig: signature(`${item.name} ${item.section ?? ""}`),
  }));
}

/** Returns the best catalog id for a raw OCR'd name, or null when not confident. */
export function matchItem(rawName: string, index: MatcherIndex, minScore = 46): string | null {
  if (!rawName || !index.length) return null;
  const q = signature(rawName);
  let best: { id: string; score: number } | null = null;
  let second = -Infinity;

  for (const entry of index) {
    const s = scoreMatch(q, entry.sig);
    if (!best || s > best.score) {
      if (best) second = best.score;
      best = { id: entry.item.id, score: s };
    } else if (s > second) {
      second = s;
    }
  }

  if (!best || best.score < minScore) return null;
  return best.id;
}
