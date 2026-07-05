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
    // 1. Get API Key from Lovable Secrets
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is missing. Please add it to Lovable Secrets/Environment Variables.");
    }

    // 2. Prepare the Image/PDF data
    const parts = data.dataUrl.split(",");
    const header = parts[0];
    const base64Data = parts[1];
    const mimeType = header.split(";")[0].split(":")[1];

    // 3. Format the Catalog for the AI
    const catalog = (data.catalog ?? []).slice(0, 600);
    const catalogText = catalog.length
      ? catalog
          .map((c) => `${c.id} | ${c.name}${c.section ? ` [${c.section}]` : ""}`)
          .join("\n")
      : "(no catalog provided)";

    const systemPrompt = `You extract structured data from Indian steel/iron trading bills (handwritten sale slips or printed invoices). 
Reply with a single JSON object ONLY. No markdown, no commentary.

FIELDS:
- vendor: shop name at the top (string|null)
- bill_no: invoice number (string|null)
- bill_date: YYYY-MM-DD (Convert from Indian format DD/MM/YYYY)
- items: array of {raw_name, qty, rate, matched_item_id}

RULES FOR ITEMS:
1. raw_name: Full item description (e.g., "C 90x45 (S.L)", "38x38x11kg").
2. qty: Usually written on the right. In handwritten slips, this is in METRIC TONNES (e.g., 0.360, 1.250). Keep the decimal exactly. Skip total/sum rows.
3. rate: Per-unit rate. If not written (common on sale slips), set to 0.
4. matched_item_id: From the CATALOG provided below, pick the ID that best matches based on size and weight. If no match, set to null.

CATALOG:
${catalogText}`;

    // 4. Call Google Gemini 1.5 Flash (Stable Free Tier)
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

    const response = await fetch(apiUrl, {
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
          temperature: 0.1,
        },
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Gemini API Error (${response.status}): ${errorBody}`);
    }

    const resJson = await response.json();
    const aiText = resJson.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!aiText) {
      throw new Error("AI returned an empty response. Check if the image is clear.");
    }

    let parsed: any;
    try {
      parsed = JSON.parse(aiText);
    } catch (e) {
      console.error("Raw AI Output:", aiText);
      throw new Error("Failed to parse AI response as JSON.");
    }

    // 5. Clean and Return Data
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
        matched_item_id:
          it.matched_item_id && validIds.has(it.matched_item_id)
            ? it.matched_item_id
            : null,
      })),
    };
  });
