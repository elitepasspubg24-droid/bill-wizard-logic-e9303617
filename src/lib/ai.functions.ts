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

export const extractBillFromImage = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      dataUrl: string;
      type: "purchase" | "sale";
      catalog?: CatalogItem[];
    }) => data,
  )
  .handler(async ({ data }): Promise<ExtractedBill> => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is missing. Please add it to Lovable Secrets.");
    }

    // 1. Prepare data
    const parts = data.dataUrl.split(",");
    const base64Data = parts[1];
    const mimeType = parts[0].split(";")[0].split(":")[1];

    const catalog = (data.catalog ?? []).slice(0, 600);
    const catalogText = catalog.length
      ? catalog.map((c) => `${c.id} | ${c.name}${c.section ? ` [${c.section}]` : ""}`).join("\n")
      : "(no catalog provided)";

    // 2. Put ALL instructions into a single text part (Most compatible way)
    const prompt = `You are a data extraction tool. Extract data from this ${data.type} bill image.
Return ONLY a valid JSON object. No other text.

JSON Structure:
{
  "vendor": "name or null",
  "bill_no": "number or null",
  "bill_date": "YYYY-MM-DD",
  "items": [
    { "raw_name": "item description", "qty": 0.000, "rate": 0, "matched_item_id": "id or null" }
  ]
}

CRITICAL RULES:
- qty: Keep decimals exactly (e.g. 0.350). Do not include total sums.
- matched_item_id: Match against the CATALOG below.
- RESPONSE: Output ONLY the JSON block starting with { and ending with }.

CATALOG:
${catalogText}`;

    // 3. Call the most stable Production URL
    const apiUrl = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt },
              { inline_data: { mime_type: mimeType, data: base64Data } },
            ],
          },
        ],
        // Removed generationConfig to avoid "Unknown name" errors
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Gemini API Error: ${response.status} - ${errorBody}`);
    }

    const resJson = await response.json();
    const aiText = resJson.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!aiText) throw new Error("AI returned no text. Check image quality.");

    // 4. Manually extract JSON from the response text
    let parsed: any;
    try {
      // Find the first { and last } to strip away any conversational text the AI might have added
      const start = aiText.indexOf("{");
      const end = aiText.lastIndexOf("}") + 1;
      const jsonString = aiText.substring(start, end);
      parsed = JSON.parse(jsonString);
    } catch (e) {
      console.error("AI Output failed to parse:", aiText);
      throw new Error("The AI response was not in a valid format. Please try again.");
    }

    // 5. Final validation
    const validIds = new Set(catalog.map((c) => c.id));
    return {
      vendor: parsed.vendor ?? null,
      bill_no: parsed.bill_no ?? null,
      bill_date: parsed.bill_date ?? null,
      items: (parsed.items || []).map((it: any) => ({
        raw_name: String(it.raw_name ?? ""),
        qty: Number(it.qty) || 0,
        rate: Number(it.rate) || 0,
        matched_item_id: (it.matched_item_id && validIds.has(it.matched_item_id)) ? it.matched_item_id : null,
      })),
    };
  });
