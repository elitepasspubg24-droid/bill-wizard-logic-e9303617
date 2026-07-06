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
 * Programmatically screens the 600-item catalog down to a compact list of candidate matches.
 * Isolates numerical steel dimension parameters and structural profile descriptors.
 */
function getCandidatesForItem(rawName: string, normalizedName: string, catalog: CatalogItem[]): CatalogItem[] {
  const cleanInput = `${rawName} ${normalizedName}`.toLowerCase();
  
  // Extract standalone numbers/dimensions (e.g., "90", "45", "5")
  const numbers = cleanInput.match(/\d+(\.\d+)?/g) || [];
  
  // Core steel profile keywords
  const keywords = ["angle", "channel", "beam", "pipe", "plate", "flat", "round", "square", "hr", "cr", "section"];
  const foundKeywords = keywords.filter(kw => cleanInput.includes(kw));
  
  const scored = catalog.map(item => {
    const itemText = `${item.name} ${item.section ?? ""}`.toLowerCase();
    let score = 0;
    
    // Major weight awarded to matching precise dimension integers/decimals
    for (const num of numbers) {
      const numRegex = new RegExp(`\\b${num.replace('.', '\\.')}\\b`);
      if (numRegex.test(itemText)) {
        score += 15;
      }
    }
    
    // Medium weight awarded to matching profile types
    for (const kw of foundKeywords) {
      if (itemText.includes(kw)) {
        score += 8;
      }
    }
    
    // Minor correction favoring strings of closely matching lengths
    score -= Math.abs(itemText.length - cleanInput.length) * 0.02;
    
    return { item, score };
  });
  
  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(s => s.item)
    .slice(0, 20); // Isolates top 20 candidate choices to avoid token overflow
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
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error("GROQ_API_KEY missing. Please add it to your Lovable environment variables.");
    }

    const isPdf = data.dataUrl.startsWith("data:application/pdf"); //[cite: 1]
    if (isPdf) {
      throw new Error(
        "Groq Vision models require image inputs (PNG, JPEG, WEBP). Please upload or convert your bill to an image format."
      );
    }

    const catalog = data.catalog ?? []; //[cite: 1]

    // ==========================================
    // STAGE 1: MULTIMODAL TEXT EXTRACTION (VISION)
    // ==========================================
    const visionPromptInstructions = `You extract structured data from Indian steel/iron trading bills. These are often HANDWRITTEN sale slips on a small pad, or printed purchase invoices. Reply with a single JSON object only. No markdown, no commentary.

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
      { type: "text", text: visionPromptInstructions },
      { type: "image_url", image_url: { url: data.dataUrl } },
    ];

    const visionRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "qwen/qwen3.6-27b",
        messages: [{ role: "user", content: userContent }],
        response_format: { type: "json_object" },
        reasoning_format: "hidden", 
        temperature: 0.1,
      }),
    });

    if (!visionRes.ok) {
      const txt = await visionRes.text();
      throw new Error(`Groq vision extraction failed: ${visionRes.status} ${txt.slice(0, 200)}`);
    }

    const visionJson = await visionRes.json();
    let visionRaw = visionJson.choices?.[0]?.message?.content ?? "{}";
    
    if (visionRaw.startsWith("```json")) {
      visionRaw = visionRaw.replace(/^```json\s*/, "").replace(/\s*```$/, "");
    } else if (visionRaw.startsWith("```")) {
      visionRaw = visionRaw.replace(/^```\s*/, "").replace(/\s*```$/, "");
    }

    let parsedVision: {
      vendor?: string | null;
      bill_no?: string | null;
      bill_date?: string | null;
      items?: Array<{ raw_name?: string; normalized_name?: string; qty?: number; rate?: number }>;
    };

    try {
      parsedVision = JSON.parse(visionRaw.trim());
    } catch {
      throw new Error("Groq vision returned non-parseable JSON: " + visionRaw.slice(0, 200));
    }

    const extractedItems = Array.isArray(parsedVision.items) ? parsedVision.items : [];
    const matchedIdMap = new Map<number, string | null>();

    // ==========================================
    // STAGE 2: INTELLIGENT AI CATALOG MATCHING
    // ==========================================
    if (extractedItems.length > 0 && catalog.length > 0) {
      // Package each item alongside its 20 custom candidates
      const matchingPayload = extractedItems.map((it, idx) => {
        const rawName = String(it.raw_name ?? "");
        const normalizedName = String(it.normalized_name ?? rawName);
        const candidates = getCandidatesForItem(rawName, normalizedName, catalog);
        
        return {
          item_index: idx,
          extracted_item: { raw_name: rawName, normalized_name: normalizedName },
          candidates: candidates.map(c => ({ id: c.id, name: c.name, section: c.section ?? null }))
        };
      });

      const matchingInstructions = `You are a precision inventory matching engine for an Indian iron and steel trading company.
Your task is to review each extracted invoice item and determine which product from the provided list of candidates is the correct match.

CRITICAL MATCHING CRITERIA:
1. MATCH PROFILE TYPES: Ensure structural profile profiles align strictly ("Channel" cannot map to "Angle", "Square Pipe" cannot map to "Round Pipe" or "Round Bar").
2. MATCH CORE DIMENSIONS: Metric measurements must align perfectly (e.g., an item containing "90x45" or "90 x 45" must be mapped to a candidate carrying those exact figures).
3. MATCH THICKNESS/WEIGHTS: Give high priority to exact thickness dimensions (e.g., "5mm") or piece weights (e.g., "11kg") when declared on the item description.
4. ABSENCE OF CANDIDATE: If none of the candidates display a high-confidence match with the target item, set matched_item_id to null.

You must return a single JSON object containing a "matches" array mapping each item_index to its matched_item_id or null. No markdown, no commentary.

DATA SET TO MATCH:
${JSON.stringify(matchingPayload, null, 2)}

EXPECTED OUTPUT FORMAT:
{"matches": [{"item_index": 0, "matched_item_id": "prod_abc123"}, {"item_index": 1, "matched_item_id": null}]}`;

      const matchingRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "qwen/qwen3.6-27b", // Using text reasoning mode with minimized token bloat
          messages: [{ role: "user", content: matchingInstructions }],
          response_format: { type: "json_object" },
          reasoning_format: "hidden",
          temperature: 0.1,
        }),
      });

      if (matchingRes.ok) {
        const matchJson = await matchingRes.json();
        let matchRaw = matchJson.choices?.[0]?.message?.content ?? "{}";
        
        if (matchRaw.startsWith("```json")) {
          matchRaw = matchRaw.replace(/^```json\s*/, "").replace(/\s*```$/, "");
        } else if (matchRaw.startsWith("```")) {
          matchRaw = matchRaw.replace(/^```\s*/, "").replace(/\s*```$/, "");
        }

        try {
          const parsedMatches = JSON.parse(matchRaw.trim());
          if (Array.isArray(parsedMatches.matches)) {
            for (const m of parsedMatches.matches) {
              if (typeof m.item_index === "number") {
                matchedIdMap.set(m.item_index, m.matched_item_id ?? null);
              }
            }
          }
        } catch (e) {
          console.error("Failed to parse intelligence match array data structure:", e);
        }
      }
    }

    // ==========================================
    // STAGE 3: CONSOLIDATION & RESPONSE RETURN
    // ==========================================
    return {
      vendor: parsedVision.vendor ?? null, //[cite: 1]
      bill_no: parsedVision.bill_no ?? null, //[cite: 1]
      bill_date: parsedVision.bill_date ?? null, //[cite: 1]
      items: extractedItems.map((it, idx) => ({
        raw_name: String(it.raw_name ?? ""),
        qty: Number(it.qty) || 0,
        rate: Number(it.rate) || 0,
        matched_item_id: matchedIdMap.get(idx) ?? null,
      })),
    };
  });
