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
    // 1. Use your own Direct API Key
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("Please add GEMINI_API_KEY to Lovable Secrets");

    // 2. Prepare the Image Data
    // dataUrl looks like: "data:image/jpeg;base64,/9j/4AAQ..."
    const parts = data.dataUrl.split(",");
    const mimeType = parts[0].split(";")[0].split(":")[1];
    const base64Data = parts[1];

    const catalog = (data.catalog ?? []).slice(0, 600);
    const catalogText = catalog.length
      ? catalog.map((c) => `${c.id} | ${c.name}${c.section ? ` [${c.section}]` : ""}`).join("\n")
      : "(no catalog provided)";

    const systemPrompt = `You extract structured data from Indian steel trading bills.
Reply with a single JSON object ONLY. No markdown, no commentary.

FIELDS:
- vendor: shop name at top (string|null)
- bill_no: (string|null)
- bill_date: YYYY-MM-DD
- items: array of {raw_name, qty, rate, matched_item_id}

RULES:
1. raw_name: Full description (e.g. "C 90x45 (S.L)").
2. qty: Almost always in Metric Tonnes (e.g. 0.360). Skip rows that are just totals.
3. rate: Set to 0 if not written.
4. matched_item_id: Match to the CATALOG below. Use the ID.

CATALOG:
${catalogText}`;

    // 3. Call Google Gemini 2.0 Flash Directly
    // This model is extremely fast, accurate for handwriting, and FREE.
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: systemPrompt },
                { inline_data: { mime_type: mimeType, data: base64Data } },
              ],
            },
          ],
          generationConfig: {
            response_mime_type: "application/json",
          },
        }),
      }
    );

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Gemini API Error: ${res.status} - ${errorText}`);
    }

    const responseData = await res.json();
    const rawContent = responseData.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!rawContent) throw new Error("AI failed to return content");

    let parsed: any;
    try {
      parsed = JSON.parse(rawContent);
    } catch (e) {
      throw new Error("Failed to parse AI JSON response");
    }

    // 4. Validate and Return
    const validIds = new Set(catalog.map((c) => c.id));
    return {
      vendor: parsed.vendor ?? null,
      bill_no: parsed.bill_no ?? null,
      bill_date: parsed.bill_date ?? null,
      items: (parsed.items || []).map((it: any) => ({
        raw_name: String(it.raw_name ?? ""),
        qty: Number(it.qty) || 0,
        rate: Number(it.rate) || 0,
        matched_item_id:
          it.matched_item_id && validIds.has(it.matched_item_id)
            ? it.matched_item_id
            : null,
      })),
    };
  });
