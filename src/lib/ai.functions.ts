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

// --- SMART MATCHING LOGIC (The "Anti-Rubbish" fix) ---
function findBestMatch(rawName: string, catalog: CatalogItem[]): string | null {
  if (!rawName || catalog.length === 0) return null;
  
  const normalizedRaw = rawName.toLowerCase()
    .replace(/[^a-z0-9]/g, " ") // Remove symbols
    .replace(/\s+/g, " ")       // Remove extra spaces
    .trim();

  let bestId: string | null = null;
  let highestScore = 0;

  for (const item of catalog) {
    const itemName = item.name.toLowerCase();
    const sectionName = (item.section ?? "").toLowerCase();
    
    let score = 0;
    // Split into tokens (e.g., "38", "38", "11kg")
    const rawTokens = normalizedRaw.split(" ").filter(t => t.length > 1);
    
    for (const token of rawTokens) {
      // If the size or weight matches exactly, boost score significantly
      if (itemName.includes(token)) score += token.length * 2;
      if (sectionName.includes(token)) score += 2;
    }

    // Exact matches get the highest priority
    if (itemName === normalizedRaw) score += 100;

    if (score > highestScore) {
      highestScore = score;
      bestId = item.id;
    }
  }

  // Only return if we have a decent level of confidence
  return highestScore > 3 ? bestId : null;
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
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("Add GEMINI_API_KEY to Lovable Secrets.");

    const parts = data.dataUrl.split(",");
    const base64Data = parts[1];
    const mimeType = parts[0].split(";")[0].split(":")[1];

    // INSTRUCTION: Focus on high-accuracy READING.
    const prompt = `You are a high-accuracy OCR for Indian steel bills.
Extract every line item from this ${data.type} document. 

OUTPUT ONLY JSON:
{
  "vendor": "Shop Name",
  "bill_no": "Number",
  "bill_date": "YYYY-MM-DD",
  "items": [
    { "raw_name": "Full Item Name with size/weight", "qty": 0.350, "rate": 0 }
  ]
}

CRITICAL:
1. QTY: Handwritten decimals are Metric Tonnes (e.g. 0.360). IGNORE line sums/totals.
2. RAW_NAME: Keep full details (e.g. "C 90x45 (S.L)" or "38x38x11kg").
3. NO COMMENTARY. NO MARKDOWN.`;

    // Using the most globally accessible Gemini URL to avoid 404s
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: base64Data } }]
        }]
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`AI Error: ${response.status}. Check if GEMINI_API_KEY is correct.`);
    }

    const resJson = await response.json();
    const aiText = resJson.candidates?.[0]?.content?.parts?.[0]?.text || "";
    
    let parsed: any;
    try {
      const start = aiText.indexOf("{");
      const end = aiText.lastIndexOf("}") + 1;
      parsed = JSON.parse(aiText.substring(start, end));
    } catch (e) {
      throw new Error("AI output was messy. Please try a clearer photo.");
    }

    // --- EXECUTE SMART MATCHING ---
    const catalog = data.catalog ?? [];
    const items = (parsed.items || []).map((it: any) => {
      const rawName = String(it.raw_name || "");
      return {
        raw_name: rawName,
        qty: Number(it.qty) || 0,
        rate: Number(it.rate) || 0,
        // We match it here using logic, much better than AI's random choice
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
