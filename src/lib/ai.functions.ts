import { createServerFn } from "@tanstack/react-start";

export type ExtractedBillItem = {
  raw_name: string;
  qty: number;
  rate: number;
  matched_item_id?: string | null;
};

export type ExtractedBill = {
  vendor: string | null;
  bill_no: string | null;
  bill_date: string | null;
  items: ExtractedBillItem[];
};

export type CatalogItem = { id: string; name: string; section?: string | null };

/**
 * DIMENSION-FIRST MATCHING ENGINE
 * AI is bad at matching IDs. This code is 100% logical. 
 * It matches steel sizes (38x38, 90x45) with mathematical precision.
 */
function dimensionMatcher(raw: string, catalog: CatalogItem[]): string | null {
  if (!raw || catalog.length === 0) return null;

  const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9.]/g, " ").replace(/\s+/g, " ").trim();
  const rawClean = clean(raw);
  // Extract numbers (dimensions) from the AI's reading (e.g., 38, 11, 1.2)
  const rawNums = rawClean.match(/\d+(\.\d+)?/g) || [];

  let bestId: string | null = null;
  let maxScore = 0;

  for (const item of catalog) {
    const itemName = clean(item.name);
    const itemNums = itemName.match(/\d+(\.\d+)?/g) || [];
    let score = 0;

    // 1. DIMENSION SCORE: Numbers in steel are truth.
    const matchingNums = itemNums.filter(n => rawNums.includes(n));
    score += (matchingNums.length * 40);

    // 2. KEYWORD OVERLAP: (Pipe, Angle, MS, KG)
    const rawTokens = rawClean.split(" ");
    for (const token of rawTokens) {
      if (token.length > 2 && itemName.includes(token)) score += 10;
    }

    // 3. EXACT MATCH BONUS
    if (itemName === rawClean) score += 200;

    if (score > maxScore) {
      maxScore = score;
      bestId = item.id;
    }
  }

  // Only return if we have a very high confidence match
  return maxScore >= 80 ? bestId : null;
}

export const extractBillFromImage = createServerFn({ method: "POST" })
  .inputValidator((data: { dataUrl: string; type: "purchase" | "sale"; catalog?: CatalogItem[] }) => data)
  .handler(async ({ data }): Promise<ExtractedBill> => {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error("Add OPENROUTER_API_KEY to Lovable Secrets.");

    const prompt = `You are a high-precision OCR engine for Indian steel trading.
Extract data from this ${data.type} bill. 

CRITICAL RULES:
1. QTY: Extract weight in METRIC TONNES (e.g. 0.350, 1.120). 
   - Handwriting check: ".350" is 0.350. "1 250" is 1.250.
2. ITEMS: Capture the full description (e.g. "38x38x11kg" or "90x45 (S.L)").
3. IGNORE: Signatures, totals, sums, and phone numbers.
4. DATE: Convert to YYYY-MM-DD.

OUTPUT VALID JSON ONLY:
{
  "vendor": "Shop Name",
  "bill_no": "Number",
  "bill_date": "YYYY-MM-DD",
  "items": [{ "raw_name": "Full size/desc", "qty": 0.000, "rate": 0 }]
}`;

    // Using Gemini 1.5 Flash via OpenRouter (Bypasses all regional 404 blocks)
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "HTTP-Referer": "https://lovable.dev", // Required by OpenRouter
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-flash-1.5", 
        messages: [{
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: data.dataUrl } }
          ]
        }],
        response_format: { type: "json_object" }
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenRouter Error: ${response.status} - ${err}`);
    }

    const resJson = await response.json();
    const aiText = resJson.choices[0]?.message?.content;
    
    if (!aiText) throw new Error("AI failed to read image.");

    let parsed: any;
    try {
      parsed = JSON.parse(aiText);
    } catch (e) {
      const start = aiText.indexOf("{");
      const end = aiText.lastIndexOf("}") + 1;
      parsed = JSON.parse(aiText.substring(start, end));
    }

    // MATCHING LOGIC (The "Anti-Rubbish" Brain)
    const catalog = data.catalog ?? [];
    const finalItems = (parsed.items || []).map((it: any) => ({
      raw_name: String(it.raw_name),
      qty: Number(it.qty) || 0,
      rate: Number(it.rate) || 0,
      matched_item_id: dimensionMatcher(String(it.raw_name), catalog)
    }));

    return {
      vendor: parsed.vendor ?? null,
      bill_no: parsed.bill_no ?? null,
      bill_date: parsed.bill_date ?? null,
      items: finalItems
    };
  });
