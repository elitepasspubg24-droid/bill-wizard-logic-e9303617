// Server-only helpers for the WhatsApp stock-enquiry bot.
import { buildIndex, matchItem, rankMatches, aliasKey } from "@/lib/item-match";

const GRAPH = "https://graph.facebook.com/v21.0";

export type Catalog = { id: string; name: string; section: string | null }[];

/** Normalised comparison key for a phone number (last 10 digits). */
export function phoneKey(p: string) {
  const d = (p || "").replace(/\D/g, "");
  return d.slice(-10);
}

export async function sendWhatsAppText(to: string, body: string) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId) throw new Error("WhatsApp credentials missing");

  const res = await fetch(`${GRAPH}/${phoneId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: body.slice(0, 4000), preview_url: false },
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    console.error(`WhatsApp send failed [${res.status}]: ${txt}`);
  }
}

/** Downloads an inbound media file and returns it as a base64 data URL. */
export async function fetchMediaDataUrl(mediaId: string) {
  const token = process.env.WHATSAPP_TOKEN;
  if (!token) throw new Error("WHATSAPP_TOKEN missing");

  const metaRes = await fetch(`${GRAPH}/${mediaId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!metaRes.ok) throw new Error(`Media lookup failed: ${metaRes.status} ${await metaRes.text()}`);
  const meta = (await metaRes.json()) as { url?: string; mime_type?: string };
  if (!meta.url) throw new Error("Media URL missing");

  const fileRes = await fetch(meta.url, { headers: { Authorization: `Bearer ${token}` } });
  if (!fileRes.ok) throw new Error(`Media download failed: ${fileRes.status}`);
  const buf = new Uint8Array(await fileRes.arrayBuffer());
  let binary = "";
  for (let i = 0; i < buf.length; i += 8192) {
    binary += String.fromCharCode(...buf.subarray(i, i + 8192));
  }
  return {
    mimeType: meta.mime_type || "image/jpeg",
    base64: btoa(binary),
  };
}

// Same rules the Bills page scanner uses, so a photo/PDF sent on WhatsApp is
// read and matched exactly like a bill uploaded on the website.
const RULES = `You extract structured data from Indian steel/iron trading bills and handwritten enquiry slips, AND you match every line to the user's own item catalog. Reply with a single JSON object only. No markdown, no commentary.

FIELDS
- items: array of {raw_name, qty, rate, match}

RULES
1. Read every line in the items section. Do not skip lines.
2. raw_name = the item description exactly as written, cleaned (e.g. "C 90x45 (S.L)", "38x38x11kg", "2x1x15kg", "25 OD x 1.00mm", "HR PLATE 4x8 6mm"). ALWAYS keep size, thickness/gauge in mm, and weight-per-piece in kg.
3. qty = the number on the right of the line, kept exactly as written (handwritten slips use tonnes like 0.360). Skip a totals/sum row joined by a bracket. If no quantity is written, use 0.
4. rate = per-unit rate if written, else 0. Never invent a rate.
5. Ignore signatures, phone/vehicle numbers, stamps, page numbers, greetings.

NOTATION
- "C 90x45" = Channel 90x45 ; "L 50x50x5" = Angle 50x50x5mm
- "38x38x11kg" = 38x38 square pipe, 11 kg/pc ; "2x1x15kg" = 2"x1" rectangular pipe, 15 kg/pc
- "25 OD x 1.00mm" = 25 OD round pipe, 1.00 mm thick ; "(S.L)" = Standard Length, keep it

MATCHING (field "match")
- match = the NUMBER of the catalog line that is the same product, or null if none fits.
- The category must agree: a channel never matches a pipe, an angle never a flat, CHQ plate never HR plate, OD pipe never square pipe. The [SECTION] tag tells you the category.
- Sizes must agree. Compare every number: outer size, thickness/gauge in mm, weight per piece in kg, length in feet, SL vs Normal.
- Handwritten weights are rounded: slip "11 kg" matches a catalog "11.5 KG" row of the same size if no exact-weight row exists. Thickness is never rounded like that.
- If two catalog rows are equally plausible, pick the one whose numbers match more exactly; if still tied, return null.
- Never invent a number. Never match only because the wording looks similar.`;


/**
 * Uses Gemini to read the enquiry (text or photo) and match each line to the
 * catalog; the local matcher is the fallback.
 */
export async function readEnquiry(
  input: { text?: string; media?: { mimeType: string; base64: string } },
  catalog: Catalog,
  aliases: { alias_key: string; item_id: string }[],
): Promise<{ raw_name: string; item_id: string | null }[]> {
  const index = buildIndex(catalog);
  const validIds = new Set(catalog.map((c) => c.id));
  const aliasMap = new Map(
    aliases.filter((a) => validIds.has(a.item_id)).map((a) => [a.alias_key, a.item_id]),
  );

  const apiKey = process.env.GEMINI_API_KEY;
  let lines: { raw_name: string; match: number | null }[] = [];

  if (apiKey) {
    const catalogList = catalog
      .slice(0, 2000)
      .map((c, i) => `${i + 1}. ${c.name}${c.section ? ` [${c.section}]` : ""}`)
      .join("\n");

    const parts: any[] = [
      {
        text: input.media
          ? `Extract this bill/enquiry document and match each line to the catalog. Return JSON: {"items":[{"raw_name":..., "qty":..., "rate":..., "match": <catalog number or null>}]}${
              input.text ? `\n\nCaption from sender: ${input.text}` : ""
            }`
          : `Extract this enquiry list and match each line to the catalog. Return JSON: {"items":[{"raw_name":..., "qty":..., "rate":..., "match": <catalog number or null>}]}\n\nList:\n${input.text}`,
      },
    ];

    if (input.media) {
      parts.push({ inlineData: { mimeType: input.media.mimeType, data: input.media.base64 } });
    }

    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: `${RULES}\n\nCATALOG\n${catalogList || "(empty)"}` }] },
            contents: [{ role: "user", parts }],
            generationConfig: {
              responseMimeType: "application/json",
              temperature: 0,
              maxOutputTokens: 4096,
              thinkingConfig: { thinkingBudget: 0 },
            },
          }),
        },
      );
      if (res.ok) {
        const json = (await res.json()) as any;
        const raw = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
        const parsed = JSON.parse(raw.trim());
        if (Array.isArray(parsed.items)) {
          lines = parsed.items.map((it: any) => ({
            raw_name: String(it.raw_name ?? "").trim(),
            match: Number.isInteger(Number(it.match)) ? Number(it.match) : null,
          }));
        }
      } else {
        console.error(`Gemini enquiry read failed [${res.status}]: ${await res.text()}`);
      }
    } catch (e) {
      console.error("Gemini enquiry read error", e);
    }
  }

  // Text-only fallback: treat each non-empty line as an item.
  if (!lines.length && input.text) {
    lines = input.text
      .split(/\n|,|;/)
      .map((l) => l.trim())
      .filter((l) => l.length >= 3)
      .map((l) => ({ raw_name: l, match: null }));
  }

  return lines
    .filter((l) => l.raw_name)
    .map((l) => {
      const modelPick =
        l.match && l.match >= 1 && l.match <= catalog.length ? catalog[l.match - 1].id : null;
      const fallback = matchItem(l.raw_name, index) ?? rankMatches(l.raw_name, index, 1)[0]?.id ?? null;
      const best = rankMatches(l.raw_name, index, 1)[0];
      return {
        raw_name: l.raw_name,
        item_id:
          aliasMap.get(aliasKey(l.raw_name)) ??
          modelPick ??
          (matchItem(l.raw_name, index) ?? (best && best.score >= 30 ? fallback : null)),
      };
    });
}

export function fmtQty(n: number) {
  return Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 3 });
}

export function fmtRate(n: number) {
  return `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export function formatItemName(name: string) {
  return name.replace(/(\d)\s*[xX×]\s*(?=\d)/g, "$1×");
}

export function fmtDate(d: string | null) {
  if (!d) return "-";
  const dt = new Date(d.length <= 10 ? `${d}T00:00:00` : d);
  if (Number.isNaN(dt.getTime())) return "-";
  return `${String(dt.getDate()).padStart(2, "0")}/${String(dt.getMonth() + 1).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Stock report: "angle stock", "pipe stock", "ujjwal stock", "all stock"
// ---------------------------------------------------------------------------

const STOCK_STOPWORDS = new Set([
  "stock", "the", "of", "in", "all", "my", "me", "show", "list", "please", "pls",
  "kitna", "kitni", "hai", "ka", "ki", "and", "total", "current", "report",
]);

/** True when the message is a stock-list enquiry rather than an item list. */
export function isStockQuery(text: string) {
  const t = (text || "").trim();
  if (!t) return false;
  if (!/\bstock\b/i.test(t)) return false;
  // Item lists carry quantities / many lines; a stock enquiry is short and has no digits.
  if (t.includes("\n")) return false;
  if (/\d/.test(t)) return false;
  return t.split(/\s+/).length <= 5;
}

function stockTokens(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOCK_STOPWORDS.has(w));
}

export type StockSection = { id: string; name: string; factory_id: string | null; position?: number | null };
export type StockFactory = { id: string; name: string };
export type StockItem = {
  id: string;
  name: string;
  section_id: string | null;
  available_qty: number | null;
  position?: number | null;
};

/**
 * Builds a neat stock list for the requested category/factory.
 * Returns null when nothing matched the words in the message.
 */
export function buildStockReport(
  text: string,
  items: StockItem[],
  sections: StockSection[],
  factories: StockFactory[],
): { messages: string[]; label: string } | null {
  const words = stockTokens(text);
  const wantsEverything = words.length === 0 || words.every((w) => w === "everything" || w === "full");

  const factoryHit = (f: StockFactory) => {
    const name = f.name.toLowerCase();
    return words.some((w) => name.includes(w));
  };
  const sectionHit = (s: StockSection) => {
    const name = s.name.toLowerCase();
    if (words.some((w) => name.includes(w))) return true;
    const factory = factories.find((f) => f.id === s.factory_id);
    return factory ? factoryHit(factory) : false;
  };

  const chosen = wantsEverything ? sections.slice() : sections.filter(sectionHit);
  if (!chosen.length) return null;

  chosen.sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0));

  const label = wantsEverything
    ? "ALL STOCK"
    : chosen.length === 1
      ? chosen[0].name.toUpperCase()
      : `${words.join(" ").toUpperCase()} STOCK`;

  const blocks: string[] = [];
  let grandTotal = 0;
  let anyRow = false;

  for (const section of chosen) {
    const rows = items
      .filter((i) => i.section_id === section.id && Number(i.available_qty || 0) !== 0)
      .sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0));
    if (!rows.length) continue;

    anyRow = true;
    const factory = factories.find((f) => f.id === section.factory_id);
    const subtotal = rows.reduce((sum, r) => sum + Number(r.available_qty || 0), 0);
    grandTotal += subtotal;

    const lines = rows.map(
      (r, i) => `${i + 1}. ${formatItemName(r.name)} — *${fmtQty(Number(r.available_qty || 0))}t*`,
    );

    blocks.push(
      `*${section.name.toUpperCase()}*${factory ? ` (${factory.name})` : ""}\n${lines.join("\n")}\n_Subtotal: ${fmtQty(subtotal)}t_`,
    );
  }

  if (!anyRow) {
    return { messages: [`*${label}*\n\nNo stock available right now.`], label };
  }

  const header = `*${label}*`;
  const footer = `*TOTAL: ${fmtQty(grandTotal)}t*`;

  // WhatsApp caps a message near 4096 chars — split on section boundaries.
  const messages: string[] = [];
  let current = header;
  for (const block of blocks) {
    if (current.length + block.length + 2 > 3500) {
      messages.push(current);
      current = block;
    } else {
      current = `${current}\n\n${block}`;
    }
  }
  if (current.length + footer.length + 2 > 3800) {
    messages.push(current);
    messages.push(footer);
  } else {
    messages.push(`${current}\n\n${footer}`);
  }

  return { messages, label };
}
