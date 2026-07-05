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
      throw new Error("GEMINI_API_KEY is missing in Lovable Secrets.");
    }

    // 1. Prepare data
    const parts = data.dataUrl.split(",");
    const base64Data = parts[1];
    const mimeType = parts[0].split(";")[0].split(":")[1];

    const catalog = (data.catalog ?? []).slice(0, 600);
    const catalogText = catalog.length
      ? catalog.map((c) => `${c.id} | ${c.name}${c.section ? ` [${c.section}]` : ""}`).join("\n")
      : "(no catalog provided)";

    // 2. Define instructions
    const systemInstruction = `You extract structured data from Indian steel trading bills (handwritten slips or invoices).
Reply with a single JSON object ONLY. No markdown, no commentary.

FIELDS:
- vendor: shop name at top (string|null)
- bill_no: (string|null)
- bill_date: YYYY-MM-DD (Convert from DD/MM/YYYY)
- items: array of {raw_name, qty, rate, matched_item_id}

RULES:
1. raw_name: Full description (e.g. "C 90x45 (S.L)").
2. qty: These are in METRIC TONNES (e.g. 0.360, 1.250). Keep the decimal exactly. SKIP rows that are just totals.
3. rate: Per-unit rate. Set to 0 if not explicitly written.
4. matched_item_id: Select the best ID from the CATALOG based on size/weight.

CATALOG:
${catalogText}`;

    // 3. Call the STABLE v1 API
    const apiUrl = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: systemInstruction }]
        },
        contents: [
          {
            parts: [
              { text: `Extract the details from this ${data.type} document.` },
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
      throw new Error(`Gemini API Error: ${response.status} - ${errorBody}`);
    }

    const resJson = await response.json();
    const aiText = resJson.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!aiText) throw new Error("AI returned empty content. Ensure the photo is clear.");

    let parsed: any;
    try {
      parsed = JSON.parse(aiText);
    } catch (e) {
      throw new Error("Failed to parse AI response.");
    }

    // 4. Return formatted data
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
