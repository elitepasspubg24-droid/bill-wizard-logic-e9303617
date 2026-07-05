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
    if (!apiKey) throw new Error("Add GEMINI_API_KEY to Lovable Secrets.");

    const parts = data.dataUrl.split(",");
    const base64Data = parts[1];
    const mimeType = parts[0].split(";")[0].split(":")[1];

    const catalog = (data.catalog ?? []).slice(0, 600);
    const catalogText = catalog.length
      ? catalog.map((c) => `${c.id} | ${c.name}${c.section ? ` [${c.section}]` : ""}`).join("\n")
      : "(no catalog provided)";

    const prompt = `Extract data from this Indian steel trading bill. 
Return ONLY a JSON object. No markdown.

{
  "vendor": "shop name",
  "bill_no": "number",
  "bill_date": "YYYY-MM-DD",
  "items": [{ "raw_name": "name", "qty": 0.350, "rate": 0, "matched_item_id": "id" }]
}

RULES:
- qty: Use Metric Tonnes (e.g. 0.450). Skip totals.
- matched_item_id: Match to this CATALOG:
${catalogText}`;

    // List of model identifiers to try (handles regional naming differences)
    const modelNames = ["gemini-1.5-flash", "gemini-1.5-flash-latest", "gemini-pro-vision"];
    let lastError = "";

    for (const model of modelNames) {
      try {
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        
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

        if (response.status === 404) {
          console.warn(`Model ${model} not found, trying next...`);
          continue; 
        }

        if (!response.ok) {
          const errTxt = await response.text();
          throw new Error(`API Error ${response.status}: ${errTxt}`);
        }

        const resJson = await response.json();
        const aiText = resJson.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!aiText) throw new Error("Empty response from AI.");

        // Clean JSON from string
        const start = aiText.indexOf("{");
        const end = aiText.lastIndexOf("}") + 1;
        const parsed = JSON.parse(aiText.substring(start, end));

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

      } catch (e: any) {
        lastError = e.message;
        if (e.message.includes("404")) continue;
        throw e;
      }
    }

    throw new Error(`Could not find a working AI model. Last error: ${lastError}`);
  });
