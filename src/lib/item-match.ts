// Deterministic local matcher for steel item names.
// The AI only has to OCR the text; matching happens here so it is fast,
// repeatable and not limited by prompt size.
//
// Catalog names are terse ("3mm (4X8)", "100x50", "10mm") and the *section*
// carries the category ("CHQ PLATE", "MS PIPE (RAIPUR)", "MS SQ BAR").
// So we parse both sides into a structured shape (category + size dims +
// thickness + kg/pc + length in feet + SL/Normal) and score field by field.

export type MatchCatalogItem = {
  id: string;
  name: string;
  section?: string | null;
};

type Category =
  | "CHANNEL"
  | "ANGLE"
  | "FLAT"
  | "BEAM"
  | "PLATE"
  | "PIPE"
  | "ROUNDBAR"
  | "SQBAR"
  | "GC"
  | null;

type Sig = {
  raw: string;
  norm: string;
  compact: string;
  cat: Category;
  /** plate family: CHQ vs HR, pipe family: OD / NB / SQ / RECT */
  sub: string | null;
  dims: number[];
  /** every number found, unit-tagged or not */
  allNums: number[];

  thickness: number | null;
  kg: number | null;
  feet: number | null;
  sl: boolean | null;
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
  ISMB: "BEAM",
  FLAT: "F",
  PATTI: "F",
  CHEQUERED: "CHQ",
  CHECKERED: "CHQ",
  CHQRD: "CHQ",
};

function num(s: string): number {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : NaN;
}

/** "2 1/2" -> "2.5", "1/2" -> "0.5" */
function resolveFractions(s: string): string {
  return s
    .replace(/(\d+)\s+(\d)\s*\/\s*(\d)/g, (_m, a, b, c) => String(num(a) + num(b) / num(c)))
    .replace(/(?<![\d.])(\d)\s*\/\s*(\d)/g, (_m, b, c) => String(num(b) / num(c)));
}

function detectCategory(upper: string): { cat: Category; sub: string | null } {
  const has = (re: RegExp) => re.test(upper);

  if (has(/\bGC\b|GALVANI[SZ]ED\s*CORRUGAT/)) return { cat: "GC", sub: null };
  if (has(/\bI\s*BEAM\b|\bBEAM\b|\bISMB\b|\bJOIST\b/)) return { cat: "BEAM", sub: null };
  if (has(/\bCHANNEL\b|\bCHNL\b|\bISMC\b/) || has(/(^|\s)C\s*\d/)) return { cat: "CHANNEL", sub: null };
  if (has(/\bANGLE\b|\bANG\b|\bISA\b/) || has(/(^|\s)L\s*\d/)) return { cat: "ANGLE", sub: null };

  if (has(/\bCHQ\b|CHEQUER|CHECKER/)) return { cat: "PLATE", sub: "CHQ" };
  if (has(/\bPLATE\b|\bPLT\b|\bSHEET\b|\bHR\b|\bCRC\b|\bGI\s*SHEET\b/)) {
    return { cat: "PLATE", sub: "HR" };
  }

  if (has(/\bO\.?D\b|\bNB\b|\bPIPE\b|\bTUBE\b/)) {
    let sub: string | null = null;
    if (has(/\bO\.?D\b/)) sub = "OD";
    else if (has(/\bNB\b/)) sub = "NB";
    return { cat: "PIPE", sub };
  }

  if (has(/\bSQ\b|\bSQR\b|\bSQUARE\b/) && has(/\bBAR\b/)) return { cat: "SQBAR", sub: null };
  if (has(/\bR(OUN)?D\b.*\bBAR\b|\bBAR\b.*\bR(OUN)?D\b|\bROUND\s*BAR\b/)) {
    return { cat: "ROUNDBAR", sub: null };
  }
  if (has(/(^|\s)F\s*\d/) || has(/\bFLAT\b|\bPATTI\b/)) return { cat: "FLAT", sub: null };
  if (has(/\bBAR\b|\bTMT\b/)) return { cat: "ROUNDBAR", sub: null };
  // Square / rectangular pipes are written as size x size x thickness/kg
  if (/\d+\s*X\s*\d+\s*X\s*\d/.test(upper) && /KG|MM/.test(upper)) {
    return { cat: "PIPE", sub: null };
  }
  return { cat: null, sub: null };
}

export function signature(raw: string): Sig {
  const upper0 = (raw || "")
    .toUpperCase()
    .replace(/[×✕]/g, "X")
    .replace(/[’‘`´]/g, "'")
    .replace(/,/g, "");
  const upper = resolveFractions(upper0);

  const kgM = upper.match(/(\d+(?:\.\d+)?)\s*KGS?\b/);
  const feetM = upper.match(/(\d+(?:\.\d+)?)\s*(?:'|\bFT\b|\bFEET\b)/);
  const nbM = upper.match(/(\d+(?:\.\d+)?)\s*NB\b/);
  const mmM = upper.match(/(\d+(?:\.\d+)?)\s*MM\b/);
  const od = /\bO\.?D\b/.test(upper);
  const slFlag = /\bS\.?\s*L\.?\b|STANDARD\s*LENGTH/.test(upper);
  const normalFlag = /\bNORMAL\b|\bNRML\b/.test(upper);

  const { cat, sub } = detectCategory(upper);

  const norm = upper
    .replace(/\bO\.?D\b/g, " OD ")
    .replace(/[()[\]{}]/g, " ")
    .replace(/[^A-Z0-9.X ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Every number, then subtract the ones that are not part of the size.
  const all = (upper.match(/\d+(?:\.\d+)?/g) ?? []).map(num).filter((n) => !Number.isNaN(n));
  const consumed: number[] = [];
  const kg = kgM ? num(kgM[1]) : null;
  const feet = feetM ? num(feetM[1]) : null;
  if (kg != null) consumed.push(kg);
  if (feet != null) consumed.push(feet);

  // thickness: explicit "...mm". For pipes the mm value is the wall thickness;
  // for plates it is the plate thickness. Either way it is not a size dim.
  let thickness = mmM ? num(mmM[1]) : null;
  // "100x100x3" style (no unit) — trailing number of a 3-part group is thickness,
  // unless that number is the kg/pc figure ("38x38x11kg").
  if (thickness == null) {
    const three = upper.match(/(\d+(?:\.\d+)?)\s*X\s*(\d+(?:\.\d+)?)\s*X\s*(\d+(?:\.\d+)?)(?!\s*\d)/);
    if (three && (cat === "PIPE" || cat === "ANGLE")) {
      const t = num(three[3]);
      if (kg == null || Math.abs(t - kg) > 1e-6) thickness = t;
    }
  }
  if (thickness != null) consumed.push(thickness);

  const nb = nbM ? num(nbM[1]) : null;

  const dimsPool = [...all];
  for (const c of consumed) {
    const i = dimsPool.findIndex((x) => Math.abs(x - c) < 1e-6);
    if (i >= 0) dimsPool.splice(i, 1);
  }
  // Bare thickness-only names ("3mm (4X8)" plate, "10mm" bar): if nothing is
  // left, the thickness/diameter IS the identifying dim.
  let dims = dimsPool.length ? dimsPool : thickness != null ? [thickness] : [];
  // Angles are written both as "L 50x50x5" and "L 50x5" — collapse the
  // repeated leg so both forms compare equal.
  if (cat === "ANGLE" && dims.length >= 2 && Math.abs(dims[0] - dims[1]) < 1e-6) {
    dims = [dims[0], ...dims.slice(2)];
  }


  const words = new Set<string>();
  for (const w of norm.split(/[ X]+/)) {
    if (!w || /^\d/.test(w)) continue;
    words.add(SYN[w] ?? w);
  }
  if (od) words.add("OD");
  if (nb != null) words.add("NB");

  return {
    raw,
    norm,
    compact: norm.replace(/[ .]/g, ""),
    cat,
    sub,
    dims: dims.slice(0, 4),
    allNums: all,

    thickness,
    kg,
    feet,
    sl: slFlag ? true : normalFlag ? false : null,
    od,
    words,
  };
}

function close(a: number, b: number, absTol = 0.001, relTol = 0.02): boolean {
  if (Math.abs(a - b) <= absTol) return true;
  const m = Math.max(Math.abs(a), Math.abs(b));
  return m > 0 && Math.abs(a - b) / m <= relTol;
}

/** fraction of the smaller list matched, penalised for length difference */
function dimScore(a: number[], b: number[]): number {
  if (!a.length || !b.length) return 0;
  const pool = [...b];
  let hits = 0;
  for (const x of a) {
    const i = pool.findIndex((y) => close(x, y));
    if (i >= 0) {
      pool.splice(i, 1);
      hits++;
    }
  }
  const ratio = hits / Math.max(a.length, b.length);
  return ratio;
}

function wordOverlap(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 0.5;
  let hits = 0;
  for (const w of a) if (b.has(w)) hits++;
  return hits / Math.max(a.size, b.size, 1);
}

function strSim(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  if (l.includes(s)) return 0.85;
  // trigram overlap
  const tri = (x: string) => {
    const set = new Set<string>();
    for (let i = 0; i < x.length - 2; i++) set.add(x.slice(i, i + 3));
    return set;
  };
  const A = tri(s);
  const B = tri(l);
  if (!A.size || !B.size) return 0;
  let hits = 0;
  for (const t of A) if (B.has(t)) hits++;
  return hits / Math.max(A.size, B.size);
}

export function scoreMatch(q: Sig, c: Sig): number {
  let score = 0;

  // 1. Category is the strongest signal — a channel is never a pipe.
  if (q.cat && c.cat) {
    if (q.cat === c.cat) score += 26;
    else return -100;
  } else if (q.cat || c.cat) {
    score -= 4;
  }

  // plate CHQ vs HR, pipe OD vs NB
  if (q.sub && c.sub) score += q.sub === c.sub ? 8 : -14;

  // 2. Sizes.
  const ds = dimScore(q.dims, c.dims);
  score += ds * 42;
  if (q.dims.length && c.dims.length && ds === 0) score -= 22;
  // ordered first-dimension bonus (90x45 vs 45x90 both fine, but 90 must exist)
  if (q.dims.length && c.dims.length && close(q.dims[0], c.dims[0])) score += 6;

  // 3. Thickness / gauge.
  if (q.thickness != null && c.thickness != null) {
    score += close(q.thickness, c.thickness, 0.06, 0.02) ? 20 : -24;
  } else if (q.thickness != null || c.thickness != null) {
    score -= 2;
  }

  // 4. Weight per piece — the decisive field on pipes.
  if (q.kg != null && c.kg != null) {
    score += Math.abs(q.kg - c.kg) < 0.26 ? 20 : -20;
  }

  // 5. Length in feet, SL vs Normal.
  if (q.feet != null && c.feet != null) score += close(q.feet, c.feet, 0.01, 0.01) ? 8 : -10;
  if (q.sl != null && c.sl != null) score += q.sl === c.sl ? 5 : -6;
  if (q.od !== c.od && (q.cat === "PIPE" || c.cat === "PIPE")) score -= 8;

  // 6. Raw-number overlap — catches unit-less writing ("114 OD x 3.6" where
  // the catalog spells the same value as a thickness).
  score += dimScore(q.allNums, c.allNums) * 14;

  // 7. Text similarity (small weight, breaks ties on wording).
  score += wordOverlap(q.words, c.words) * 12;
  score += strSim(q.compact, c.compact) * 12;

  return score;
}

export type MatcherIndex = { item: MatchCatalogItem; sig: Sig }[];

export function buildIndex(catalog: MatchCatalogItem[]): MatcherIndex {
  return catalog.map((item) => {
    // Section first so category detection sees "MS PIPE" / "CHQ PLATE",
    // but keep the name's own numbers intact.
    const sig = signature(`${item.name} ${item.section ?? ""}`);
    const nameSig = signature(item.name);
    // dims/thickness/kg must come from the NAME only, never the section text.
    return {
      item,
      sig: {
        ...sig,
        dims: nameSig.dims,
        allNums: nameSig.allNums,
        thickness: nameSig.thickness,
        kg: nameSig.kg,
        feet: nameSig.feet ?? sig.feet,
        compact: nameSig.compact,
      },
    };
  });
}


/**
 * Returns the best catalog id for a raw OCR'd name, or null when not confident.
 * `minScore` is the absolute floor; `margin` guards against near-ties between
 * two catalog rows that differ in a field the slip did not spell out.
 */
export function matchItem(
  rawName: string,
  index: MatcherIndex,
  minScore = 48,
  margin = 4,
): string | null {
  const best = rankMatches(rawName, index, 2);
  if (!best.length) return null;
  const top = best[0];
  if (top.score < minScore) return null;
  if (best[1] && top.score - best[1].score < margin) return null;
  return top.id;
}

/** Top-N candidates, best first — useful for showing suggestions in the UI. */
export function rankMatches(
  rawName: string,
  index: MatcherIndex,
  limit = 5,
): { id: string; name: string; score: number }[] {
  if (!rawName || !index.length) return [];
  const q = signature(rawName);
  const scored = index.map((e) => ({
    id: e.item.id,
    name: e.item.name,
    score: scoreMatch(q, e.sig),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

/** Stable key used to remember a manual mapping for an OCR'd line. */
export function aliasKey(rawName: string): string {
  return signature(rawName).norm.replace(/\s+/g, " ").trim();
}
