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
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error("Add GROQ_API_KEY to Lovable Secrets.");

    const catalog = (data.catalog ?? []).slice(0, 600);
    const catalogText = catalog.length
      ? catalog.map((c) => `${c.id} | ${c.name}${c.section ? ` [${c.section}]` : ""}`).join("\n")
      : "(no catalog provided)";

    const prompt = `You are a data extraction bot for Indian steel trading.
Extract details from this ${data.type} document into valid JSON.

JSON Structure:
{
  "vendor": "shop name or null",
  "bill_no": "invoice number or null",
  "bill_date": "YYYY-MM-DD",
  "items": [
    { "raw_name": "description", "qty": 0.350, "rate": 0, "matched_item_id": "id or null" }
  ]
}

CRITICAL RULES:
1. QTY: Handwritten slips use Metric Tonnes (e.g. 0.350, 1.220). KEEP decimals. IGNORE totals.
2. MATCHED_ITEM_ID: Pick the best ID from the CATALOG below.
3. Response must be ONLY valid JSON.

CATALOG:
${catalogText}`;

    // Use the NEW stable model name: llama-3.2-11b-vision-instant
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.2-11b-vision-instant",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: data.dataUrl } },
            ],
          },
        ],
        response_format: { type: "json_object" },
        temperature: 0,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Groq API Error: ${response.status} - ${err}`);
    }

    const resJson = await response.json();
    const content = resJson.choices[0]?.message?.content;
    
    if (!content) throw new Error("AI returned no content.");
    
    const parsed = JSON.parse(content);
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
