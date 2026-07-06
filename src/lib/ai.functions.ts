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
 * STEEL-LOGIC MATCHING ENGINE
 */
function findSteelMatch(rawRead: string, catalog: CatalogItem[]): string | null {
  if (!rawRead || catalog.length === 0) return null;

  const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9.]/g, " ").replace(/\s+/g, " ").trim();
  const rawClean = clean(rawRead);
  const rawNums = rawClean.match(/\d+(\.\d+)?/g) || [];

  let bestId: string | null = null;
  let maxScore = 0;

  for (const item of catalog) {
    const itemName = clean(item.name);
    const itemNums = itemName.match(/\d+(\.\d+)?/g) || [];
    let score = 0;

    const matchedNums = itemNums.filter((n: string) => (rawNums as string[]).includes(n));
    score += (matchedNums.length * 40);

    const rawTokens = rawClean.split(" ");
    for (const token of rawTokens) {
      if (token.length > 2 && itemName.includes(token)) score += 10;
    }

    if (itemName === rawClean) score += 200;

    if (score > maxScore) {
      maxScore = score;
      bestId = item.id;
    }
  }

  return maxScore >= 70 ? bestId : null;
}

export const extractBillFromImage = createServerFn({ method: "POST" })
  .inputValidator((data: { dataUrl: string; type: "purchase" | "sale"; catalog?: CatalogItem[] }) => data)
  .handler(async ({ data }): Promise<ExtractedBill> => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY not configured.");

    const prompt = `You are a high-precision OCR for an Indian Steel Yard.
Read this ${data.type} document. Extract items, weights (Metric Tonnes), and rates.

CRITICAL RULES:
- QTY: Keep decimals (e.g. 0.350). ".450" is 0.450.
- NAME: Extract the full size/description (e.g. "38x38x11kg").
- TOTALS: Skip all sum/total rows.
- FORMAT: Return ONLY valid JSON.

{
  "vendor": "Name",
  "bill_no": "Number",
  "bill_date": "YYYY-MM-DD",
  "items": [{ "raw_name": "Full Desc", "qty": 0.000, "rate": 0 }]
}`;

    // Lovable AI Gateway — no user key needed, includes free monthly allowance
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
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
      if (response.status === 429) throw new Error("Rate limit hit. Wait a moment and retry.");
      if (response.status === 402) throw new Error("AI credits exhausted. Add credits in Lovable settings.");
      throw new Error(`AI failed (${response.status}): ${errorText.slice(0, 200)}`);
    }

    const resJson = await response.json();
    const aiText = resJson.choices?.[0]?.message?.content;

    if (!aiText) throw new Error("AI returned no text. Check photo clarity.");


    let parsed: any;
    try {
      parsed = JSON.parse(aiText);
    } catch (e) {
      const start = aiText.indexOf("{");
      const end = aiText.lastIndexOf("}") + 1;
      parsed = JSON.parse(aiText.substring(start, end));
    }

    const catalog = data.catalog ?? [];
    const processedItems = (parsed.items || []).map((it: any) => ({
      raw_name: String(it.raw_name),
      qty: Number(it.qty) || 0,
      rate: Number(it.rate) || 0,
      matched_item_id: findSteelMatch(String(it.raw_name), catalog)
    }));

    return {
      vendor: parsed.vendor ?? null,
      bill_no: parsed.bill_no ?? null,
      bill_date: parsed.bill_date ?? null,
      items: processedItems
    };
  });
