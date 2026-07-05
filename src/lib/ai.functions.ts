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
 * LOGIC-BASED MATCHING ENGINE (Anti-Rubbish)
 * Matches steel dimensions (e.g. 38x38, 90x45) mathematically.
 */
function findPerfectSteelMatch(rawRead: string, catalog: CatalogItem[]): string | null {
  if (!rawRead || catalog.length === 0) return null;

  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9.]/g, " ").replace(/\s+/g, " ").trim();
  const rawClean = normalize(rawRead);
  const rawNums = rawClean.match(/\d+(\.\d+)?/g) || [];

  let bestId: string | null = null;
  let maxScore = 0;

  for (const item of catalog) {
    const itemName = normalize(item.name);
    const itemNums = itemName.match(/\d+(\.\d+)?/g) || [];
    let score = 0;

    // 1. DIMENSION WEIGHTING: If numbers like 38, 90, 1.2 match, it's likely the same item.
    const matchedNums = itemNums.filter(n => rawNums.includes(n));
    score += (matchedNums.length * 50); 

    // 2. KEYWORD OVERLAP: (Pipe, Angle, KG, OD)
    const rawTokens = rawClean.split(" ");
    for (const token of rawTokens) {
      if (token.length > 2 && itemName.includes(token)) score += 10;
    }

    // 3. EXACT STRING MATCH
    if (itemName === rawClean) score += 200;

    if (score > maxScore) {
      maxScore = score;
      bestId = item.id;
    }
  }

  // Threshold: Requires at least two numbers or one exact size to match
  return maxScore >= 100 ? bestId : null;
}

export const extractBillFromImage = createServerFn({ method: "POST" })
  .inputValidator((data: { dataUrl: string; type: "purchase" | "sale"; catalog?: CatalogItem[] }) => data)
  .handler(async ({ data }): Promise<ExtractedBill> => {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error("Add OPENROUTER_API_KEY to Lovable Secrets.");

    const prompt = `OCR INSTRUCTION: Read this Indian steel trading bill.
Focus on identifying line items, weights, and rates.

CRITICAL RULES:
- QTY: Metric Tonnes (e.g. 0.350, 1.250). Keep decimals exactly. ".450" is 0.450.
- NAME: Extract sizes exactly as written (e.g. "38x38x11kg").
- TOTALS: Skip the sum/total rows at the bottom.
- OUTPUT: Valid JSON only.

{
  "vendor": "Shop Name",
  "bill_no": "Number",
  "bill_date": "YYYY-MM-DD",
  "items": [{ "raw_name": "Full string", "qty": 0.000, "rate": 0 }]
}`;

    // google/gemini-2.0-flash-exp:free is the most reliable high-quality free model on OpenRouter
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "HTTP-Referer": "https://lovable.dev",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.0-flash-exp:free", 
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
      const errorText = await response.text();
      throw new Error(`Connection Error ${response.status}: ${errorText}`);
    }

    const resJson = await response.json();
    const aiOutput = resJson.choices[0]?.message?.content;
    
    if (!aiOutput) throw new Error("AI returned no data. Ensure image is clear.");

    let parsed: any;
    try {
      parsed = JSON.parse(aiOutput);
    } catch (e) {
      // Manual recovery if JSON mode fails
      const start = aiOutput.indexOf("{");
      const end = aiOutput.lastIndexOf("}") + 1;
      parsed = JSON.parse(aiOutput.substring(start, end));
    }

    // APPLY MATCHING ENGINE
    const catalog = data.catalog ?? [];
    const processedItems = (parsed.items || []).map((it: any) => ({
      raw_name: String(it.raw_name),
      qty: Number(it.qty) || 0,
      rate: Number(it.rate) || 0,
      matched_item_id: findPerfectSteelMatch(String(it.raw_name), catalog)
    }));

    return {
      vendor: parsed.vendor ?? null,
      bill_no: parsed.bill_no ?? null,
      bill_date: parsed.bill_date ?? null,
      items: processedItems
    };
  });
