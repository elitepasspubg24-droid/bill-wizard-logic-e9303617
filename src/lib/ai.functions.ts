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

// --- THE SMART MATCHER (Fixes the "Rubbish" matching) ---
function findBestMatch(rawName: string, catalog: CatalogItem[]): string | null {
  if (!rawName || catalog.length === 0) return null;
  
  const cleanRaw = rawName.toLowerCase().replace(/[^a-z0-9]/g, " ");
  const rawTokens = cleanRaw.split(" ").filter(t => t.length >= 2);

  let bestId: string | null = null;
  let highestScore = 0;

  for (const item of catalog) {
    const itemName = item.name.toLowerCase();
    const sectionName = (item.section ?? "").toLowerCase();
    let score = 0;

    // Check how many parts of the name (like "38", "38", "11kg") appear in your catalog item
    for (const token of rawTokens) {
      if (itemName.includes(token)) score += 10;
      if (sectionName.includes(token)) score += 2;
    }

    // Exact string matches get a massive boost
    if (itemName === cleanRaw.trim()) score += 100;

    if (score > highestScore) {
      highestScore = score;
      bestId = item.id;
    }
  }

  // Only return if we have a solid match (score > 15)
  return highestScore > 15 ? bestId : null;
}

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
    if (!apiKey) throw new Error("Add MISTRAL_API_KEY to Lovable Secrets.");

    const prompt = `You are a professional data entry bot for an Indian steel trader.
Read the attached bill and extract vendor name, bill number, date, and every line item.

OUTPUT JSON ONLY:
{
  "vendor": "Name of shop/party",
  "bill_no": "Number",
  "bill_date": "YYYY-MM-DD",
  "items": [
    { "raw_name": "Full item description with size and weight", "qty": 0.350, "rate": 0 }
  ]
}

RULES:
1. QTY: Handwritten decimals are Metric Tonnes (e.g. 0.350, 1.250). Keep the decimals!
2. TOTALS: Do NOT include sum/total rows.
3. DATE: Convert Indian DD/MM/YYYY to YYYY-MM-DD.`;

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
      const err = await response.text();
      throw new Error(`Mistral Error: ${response.status} - ${err}`);
    }

    const resJson = await response.json();
    const aiText = resJson.choices[0]?.message?.content;
    
    let parsed: any;
    try {
      parsed = JSON.parse(aiText);
    } catch (e) {
      // Logic fallback to find JSON block
      const start = aiText.indexOf("{");
      const end = aiText.lastIndexOf("}") + 1;
      parsed = JSON.parse(aiText.substring(start, end));
    }

    const catalog = data.catalog ?? [];
    const items = (parsed.items || []).map((it: any) => {
      const rawName = String(it.raw_name || "");
      return {
        raw_name: rawName,
        qty: Number(it.qty) || 0,
        rate: Number(it.rate) || 0,
        // CRITICAL: Logic-based matching, much more reliable than AI
        matched_item_id: findBestMatch(rawName, catalog)
      };
    });

    return {
      vendor: parsed.vendor ?? null,
      bill_no: parsed.bill_no ?? null,
      bill_date: parsed.bill_date ?? null,
      items: items
    };
  });
