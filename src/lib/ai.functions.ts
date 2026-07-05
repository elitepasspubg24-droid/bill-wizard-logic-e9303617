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
    // 1. Setup API Key from Lovable Secrets
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is missing in Lovable Secrets. Please add it in Settings.");
    }

    // 2. Format Image/PDF data
    const parts = data.dataUrl.split(",");
    const base64Data = parts[1];
    const mimeType = parts[0].split(";")[0].split(":")[1];

    // 3. Prepare Product Catalog for AI matching
    const catalog = (data.catalog ?? []).slice(0, 600);
    const catalogText = catalog.length
      ? catalog.map((c) => `${c.id} | ${c.name}${c.section ? ` [${c.section}]` : ""}`).join("\n")
      : "(no catalog provided)";

    // 4. Create Instructions
    const prompt = `You are an expert at reading Indian steel/iron trading bills and handwritten sale slips.
Extract the data from this ${data.type} document into a structured JSON format.

FIELDS:
- vendor: Name of the shop/party at the top (string or null)
- bill_no: Invoice or slip number (string or null)
- bill_date: Date in YYYY-MM-DD format (Convert from DD/MM/YYYY or DD-MM-YY)
- items: Array of objects with {raw_name, qty, rate, matched_item_id}

RULES:
1. QTY: In handwritten slips, weight is usually in METRIC TONNES (e.g., 0.350, 1.250). Keep the decimal exactly as written. IGNORE lines that are just totals/sums of previous lines.
2. RATE: Only include if explicitly written. On sale slips, if no rate is mentioned, set to 0.
3. MATCHED_ITEM_ID: Match each row to the provided CATALOG below. Choose the ID that best fits the size/weight. Use null if unsure.
4. RESPONSE: Return ONLY the JSON object. No conversation.

CATALOG:
${catalogText}`;

    // 5. Direct Call to Gemini API (v1beta for best JSON support)
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

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
        generationConfig: {
          response_mime_type: "application/json",
          temperature: 0.1,
        },
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(`Gemini API Error (${response.status}): ${errorData}`);
    }

    const result = await response.json();
    const aiText = result.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!aiText) {
      throw new Error("AI could not read any text. Ensure the photo is clear and well-lit.");
    }

    // 6. Clean and Parse JSON
    let parsed: any;
    try {
      // Remove any accidental markdown formatting if present
      const cleanJson = aiText.replace(/```json|```/g, "").trim();
      parsed = JSON.parse(cleanJson);
    } catch (e) {
      console.error("Raw AI Output:", aiText);
      throw new Error("Failed to process bill data. Please try uploading again.");
    }

    // 7. Map items back to valid catalog IDs
    const validIds = new Set(catalog.map((c) => c.id));
    const items = Array.isArray(parsed.items) ? parsed.items : [];

    return {
      vendor: parsed.vendor ?? null,
      bill_no: parsed.bill_no ?? null,
      bill_date: parsed.bill_date ?? null,
      items: items.map((it: any) => ({
        raw_name: String(it.raw_name ?? ""),
        qty: Number(it.qty) || 0,
        rate: Number(it.rate) || 0,
        matched_item_id: (it.matched_item_id && validIds.has(it.matched_item_id)) ? it.matched_item_id : null,
      })),
    };
  });
