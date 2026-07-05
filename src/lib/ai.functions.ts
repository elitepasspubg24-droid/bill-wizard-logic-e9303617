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
      throw new Error("GEMINI_API_KEY is missing. Add it to Lovable Secrets.");
    }

    // 1. Clean the data for the API
    const parts = data.dataUrl.split(",");
    const base64Data = parts[1];
    const mimeType = parts[0].split(";")[0].split(":")[1];

    const catalog = (data.catalog ?? []).slice(0, 600);
    const catalogText = catalog.length
      ? catalog.map((c) => `${c.id} | ${c.name}${c.section ? ` [${c.section}]` : ""}`).join("\n")
      : "(no catalog provided)";

    // 2. Simplest possible prompt to avoid 400 errors
    const prompt = `Extract data from this ${data.type} bill. 
Return a JSON object exactly like this:
{
  "vendor": "name",
  "bill_no": "number",
  "bill_date": "YYYY-MM-DD",
  "items": [
    { "raw_name": "name", "qty": 0.350, "rate": 0, "matched_item_id": "id" }
  ]
}

RULES:
- qty: Use metric tonnes (e.g. 0.350).
- matched_item_id: Match to this CATALOG:
${catalogText}`;

    // 3. The Most Robust Endpoint
    // We use v1beta because it's the only one that reliably supports the Flash 1.5 model for image/text combos
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: mimeType, data: base64Data } }
          ]
        }]
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      // If you see 404 here, it's a Google/Region issue. We catch it and explain.
      if (response.status === 404) {
        throw new Error("Google Gemini Flash 1.5 is currently unavailable in your account's region. Try creating a new API key in Google AI Studio.");
      }
      throw new Error(`Gemini Error ${response.status}: ${errorText}`);
    }

    const resJson = await response.json();
    const aiText = resJson.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!aiText) throw new Error("AI returned no text. Try a clearer photo.");

    // 4. Manual JSON recovery (The most "coding" part)
    // AI often wraps JSON in ```json blocks or adds text before/after.
    // This logic finds the actual JSON block and extracts it.
    let parsed: any;
    try {
      const startJson = aiText.indexOf("{");
      const endJson = aiText.lastIndexOf("}") + 1;
      const jsonString = aiText.substring(startJson, endJson);
      parsed = JSON.parse(jsonString);
    } catch (e) {
      console.error("AI Response was:", aiText);
      throw new Error("AI response was not formatted correctly. Please try again.");
    }

    // 5. Mapping and Validation
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
