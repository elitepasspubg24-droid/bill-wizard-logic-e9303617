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

    // 1. Prepare Image/PDF data for the API
    const parts = data.dataUrl.split(",");
    const base64Data = parts[1];
    const mimeType = parts[0].split(";")[0].split(":")[1];

    // 2. Format Catalog for AI matching
    const catalog = (data.catalog ?? []).slice(0, 600);
    const catalogText = catalog.length
      ? catalog.map((c) => `${c.id} | ${c.name}${c.section ? ` [${c.section}]` : ""}`).join("\n")
      : "(no catalog provided)";

    // 3. Construct the prompt for the AI
    const prompt = `You are a data extraction expert for Indian steel trading bills.
Extract the following details into a single JSON object ONLY. No markdown, no extra text.

FIELDS:
- vendor: Name of the shop/party at the top (string or null)
- bill_no: Invoice number (string or null)
- bill_date: Date in YYYY-MM-DD format (Convert from DD/MM/YYYY or DD-MM-YY)
- items: Array of objects: { "raw_name": string, "qty": number, "rate": number, "matched_item_id": string or null }

RULES:
1. QTY: Metric Tonnes (e.g., 0.350). Keep decimals EXACTLY as written. IGNORE TOTALS/SUMS.
2. RATE: Use the rate written on the line. If none, use 0.
3. MATCHED_ITEM_ID: Match each item's raw_name to the CATALOG ID. Use null if no good match.

CATALOG:
${catalogText}`;

    // 4. Use the stable production endpoint for Gemini Pro Vision
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro-vision:generateContent?key=${apiKey}`;

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
        // Removed generationConfig to ensure broadest compatibility
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Gemini API Error (${response.status}): ${errorBody}`);
    }

    const resJson = await response.json();
    const aiText = resJson.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!aiText) {
      throw new Error("AI returned no text. Ensure the image is clear and contains text.");
    }

    // 5. Manually extract JSON from the response
    let parsed: any;
    try {
      // Find the JSON block, stripping any surrounding markdown or text
      const startJson = aiText.indexOf("{");
      const endJson = aiText.lastIndexOf("}") + 1;
      const jsonString = aiText.substring(startJson, endJson);
      parsed = JSON.parse(jsonString);
    } catch (e) {
      console.error("AI Output:", aiText);
      throw new Error("Could not parse AI response. Try again.");
    }

    // 6. Validate and return data
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
