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
    const apiKey = process.env.MISTRAL_API_KEY;
    if (!apiKey) throw new Error("Please add MISTRAL_API_KEY to Lovable Secrets.");

    const catalog = (data.catalog ?? []).slice(0, 600);
    const catalogText = catalog.length
      ? catalog.map((c) => `${c.id} | ${c.name}${c.section ? ` [${c.section}]` : ""}`).join("\n")
      : "(no catalog provided)";

    const prompt = `You are a professional data entry operator for an Indian steel trader.
Extract data from this ${data.type} document (could be a handwritten sale slip or printed bill).

OUTPUT FORMAT:
Return ONLY a valid JSON object. No other text. 
{
  "vendor": "Name of shop or party",
  "bill_no": "Invoice number if exists",
  "bill_date": "YYYY-MM-DD",
  "items": [
    { "raw_name": "Item description", "qty": 0.350, "rate": 0, "matched_item_id": "ID from catalog" }
  ]
}

CRITICAL RULES:
1. QTY: Handwritten slips use METRIC TONNES (e.g., 0.350, 1.250). Keep the decimals exactly.
2. TOTALS: Ignore rows that are just a sum/total of previous items.
3. MATCHING: Select the best ID from the CATALOG below based on size/weight.
4. DATE: Convert Indian DD/MM/YYYY to YYYY-MM-DD.

CATALOG:
${catalogText}`;

    // Mistral Pixtral (Highly stable for vision tasks)
    const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "pixtral-12b-2409",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: data.dataUrl },
            ],
          },
        ],
        response_format: { type: "json_object" },
        temperature: 0,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Mistral Error ${response.status}: ${errorText}`);
    }

    const resJson = await response.json();
    const aiText = resJson.choices?.[0]?.message?.content;

    if (!aiText) throw new Error("AI could not read the image. Please try a clearer photo.");

    let parsed: any;
    try {
      parsed = JSON.parse(aiText);
    } catch (e) {
      // Fallback: search for JSON in text if it's not a pure object
      const start = aiText.indexOf("{");
      const end = aiText.lastIndexOf("}") + 1;
      parsed = JSON.parse(aiText.substring(start, end));
    }

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
