import { createServerFn } from "@tanstack/react-start"; //[cite: 1]

export type ExtractedBillItem = { //[cite: 1]
  raw_name: string; //[cite: 1]
  qty: number; //[cite: 1]
  rate: number; //[cite: 1]
  matched_item_id?: string | null; //[cite: 1]
}; //[cite: 1]

export type ExtractedBill = { //[cite: 1]
  vendor: string | null; //[cite: 1]
  bill_no: string | null; //[cite: 1]
  bill_date: string | null; //[cite: 1]
  items: ExtractedBillItem[]; //[cite: 1]
}; //[cite: 1]

export type CatalogItem = { id: string; name: string; section?: string | null }; //[cite: 1]

/**
 * High-performance client/server-side keyword matching algorithm.
 * Bypasses Groq's TPM limits by handling item matching natively in TypeScript.
 */
function matchItemToCatalog(
  rawName: string,
  normalizedName: string,
  catalog: CatalogItem[]
): string | null {
  if (!catalog.length) return null;

  // Clean and tokenize the text extracted by the AI
  const searchString = `${rawName} ${normalizedName}`
    .toLowerCase()
    .replace(/[^a-z0-9.]/g, " ");
  const searchTokens = Array.from(
    new Set(searchString.split(/\s+/).filter((t) => t.length > 1))
  );

  if (!searchTokens.length) return null;

  let bestMatchId: string | null = null;
  let highestScore = 0;

  for (const item of catalog) {
    const catalogString = `${item.name} ${item.section ?? ""}`
      .toLowerCase()
      .replace(/[^a-z0-9.]/g, " ");
    const catalogTokens = catalogString.split(/\s+/).filter(Boolean);

    let matches = 0;
    for (const token of searchTokens) {
      if (catalogTokens.some((ct) => ct.includes(token) || token.includes(ct))) {
        matches++;
      }
    }

    // Calculate match confidence ratio
    const score = matches / Math.max(searchTokens.length, 1);
    
    // Minimum threshold for matching iron/steel dimensions accurately
    if (score > highestScore && score >= 0.45) {
      highestScore = score;
      bestMatchId = item.id;
    }
  }

  return bestMatchId;
}

export const extractBillFromImage = createServerFn({ method: "POST" }) //[cite: 1]
  .inputValidator( //[cite: 1]
    (data: { //[cite: 1]
      dataUrl: string; //[cite: 1]
      type: "purchase" | "sale"; //[cite: 1]
      catalog?: CatalogItem[]; //[cite: 1]
    }) => data, //[cite: 1]
  ) //[cite: 1]
  .handler(async ({ data }): Promise<ExtractedBill> => { //[cite: 1]
    // Use the free-tier Groq API key
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error("GROQ_API_KEY missing. Please add it to your Lovable environment variables.");
    }

    // Groq Vision requires image payloads (PNG, JPEG, WEBP), not raw PDFs
    const isPdf = data.dataUrl.startsWith("data:application/pdf"); //[cite: 1]
    if (isPdf) {
      throw new Error(
        "Groq Vision models require image inputs (PNG, JPEG, WEBP). Please upload or convert your bill to an image format."
      );
    }

    // Groq reasoning models require instructions to reside entirely inside the user message context
    const promptInstructions = `You extract structured data from Indian steel/iron trading bills. These are often HANDWRITTEN sale slips on a small pad, or printed purchase invoices. Reply with a single JSON object only. No markdown, no commentary.

FIELDS
- vendor: party/shop name at top of the slip (string|null)
- bill_no: bill number if visible (string|null)
- bill_date: YYYY-MM-DD. Indian slips use DD/MM/YYYY or DD|MM|YYYY — convert.
- items: array of {raw_name, normalized_name, qty, rate}

RULES FOR ITEMS
1. Read every line in the items section. Do not skip lines.
2. raw_name = the full item description exactly as written (e.g. "C 90x45 (S.L)", "38x38x11kg", "2x1x15kg", "25 OD x 1.00mm"). Preserve size, thickness/gauge, and weight-per-piece.
3. normalized_name = expand abbreviations into descriptive English to assist local string searching (e.g., "C 90x45 (S.L)" -> "Channel 90x45 Standard Length", "L 50x50x5" -> "Angle 50x50x5mm", "HR PLATE" -> "Hot Rolled Plate").
4. qty is the NUMBER written on the right side of that line. In handwritten sale slips this is almost always in METRIC TONNES written as a decimal like 0.360, 0.220 — keep it exactly as written. Skip summary/total sum rows.
5. rate: per-unit rate if written on the line. Handwritten sale slips usually DO NOT have per-item rates — set rate to 0 in that case. Do not invent a rate.

STEEL NOTATION HINTS
- "C 90x45" = Channel 90x45
- "L 50x50x5" = Angle 50x50x5mm
- "38x38x11kg" or "38x38 (11kg)" = 38x38 SQUARE pipe, 11 kg per piece
- "2x1x15kg" = 2"x1" RECTANGULAR pipe, 15 kg per piece
- "25 OD x 1.00mm" = 25 OD round pipe, 1.00 mm thickness
- "(S.L)" / "(sl)" = Standard Length — keep it in raw_name

TASK: Extract this ${data.type} bill. Follow the rules exactly. 
Return JSON format matching: {"vendor":..., "bill_no":..., "bill_date":..., "items":[{"raw_name":..., "normalized_name":..., "qty":..., "rate":...}]}`; //[cite: 1]

    const userContent = [
      {
        type: "text",
        text: promptInstructions,
      },
      {
        type: "image_url",
        image_url: {
          url: data.dataUrl,
        },
      },
    ];

    // Request executing directly against Groq's active production vision model
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "qwen/qwen3.6-27b",
        messages: [{ role: "user", content: userContent }],
        response_format: { type: "json_object" },
        reasoning_format: "hidden", // Directs Groq to strip internal reasoning trace structures from response text
        temperature: 0.1,
      }),
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Groq extraction failed: ${res.status} ${txt.slice(0, 200)}`);
    }

    const json = await res.json();
    let raw = json.choices?.[0]?.message?.content ?? "{}";
    
    // Clean defensive markdown fence filtering
    if (raw.startsWith("```json")) {
      raw = raw.replace(/^```json\s*/, "").replace(/\s*```$/, "");
    } else if (raw.startsWith("```")) {
      raw = raw.replace(/^```\s*/, "").replace(/\s*```$/, "");
    }

    let parsed: {
      vendor?: string | null;
      bill_no?: string | null;
      bill_date?: string | null;
      items?: Array<{ raw_name?: string; normalized_name?: string; qty?: number; rate?: number }>;
    };

    try {
      parsed = JSON.parse(raw.trim());
    } catch {
      throw new Error("Groq returned non-parseable JSON: " + raw.slice(0, 200));
    }

    const catalog = data.catalog ?? []; //[cite: 1]
    const items = Array.isArray(parsed.items) ? parsed.items : [];

    return {
      vendor: parsed.vendor ?? null, //[cite: 1]
      bill_no: parsed.bill_no ?? null, //[cite: 1]
      bill_date: parsed.bill_date ?? null, //[cite: 1]
      items: items.map((it) => {
        const rawName = String(it.raw_name ?? "");
        const normalizedName = String(it.normalized_name ?? rawName);
        
        // Execute the server-side keyword validation match
        const matchedId = matchItemToCatalog(rawName, normalizedName, catalog);

        return {
          raw_name: rawName,
          qty: Number(it.qty) || 0,
          rate: Number(it.rate) || 0,
          matched_item_id: matchedId,
        };
      }),
    };
  });
