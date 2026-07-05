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

/**
 * SMART STEEL MATCHER
 * This is the "Brain" that fixes the matching issues.
 * It ignores the AI's "guesses" and uses a dimension-matching algorithm.
 */
function solveSteelMatch(rawName: string, catalog: CatalogItem[]): string | null {
  if (!rawName || catalog.length === 0) return null;

  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
  const rawClean = normalize(rawName);
  
  // Extract all numbers (sizes) from the AI's text
  const rawDimensions = rawClean.match(/\d+/g) || [];
  
  let bestId: string | null = null;
  let maxScore = 0;

  for (const item of catalog) {
    const itemName = normalize(item.name);
    const itemDimensions = itemName.match(/\d+/g) || [];
    let score = 0;

    // 1. DIMENSION CHECK (Highest priority for steel)
    // If the AI sees "38 38 11kg" and catalog has "38x38 (11kg)", we match.
    const matchedDims = itemDimensions.filter(d => rawDimensions.includes(d));
    score += (matchedDims.length * 25);

    // 2. KEYWORD OVERLAP
    const rawTokens = rawClean.split(" ");
    for (const token of rawTokens) {
      if (token.length > 1 && itemName.includes(token)) score += 5;
    }

    // 3. EXACT MATCH BONUS
    if (itemName === rawClean) score += 100;

    if (score > maxScore) {
      maxScore = score;
      bestId = item.id;
    }
  }

  // Threshold: If the match score is low, don't guess wrong.
  return maxScore >= 40 ? bestId : null;
}

export const extractBillFromImage = createServerFn({ method: "POST" })
  .inputValidator((data: { dataUrl: string; type: "purchase" | "sale"; catalog?: CatalogItem[] }) => data)
  .handler(async ({ data }): Promise<ExtractedBill> => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is missing in Secrets.");

    // Extract raw base64 data
    const parts = data.dataUrl.split(",");
    const base64Data = parts[1];
    const mimeType = parts[0].split(";")[0].split(":")[1];

    // THE PROMPT: Optimized for Indian Steel handwriting and high-accuracy reading
    const extractionPrompt = `You are a professional auditor for an Indian steel factory. 
Extract data from this ${data.type} bill (handwritten or printed). 

RULES:
1. QUANTITY: Extract weight in METRIC TONNES (e.g. .350, 0.450, 1.250). Keep the decimals exactly.
2. ITEMS: Capture sizes/names exactly (e.g. "38x38x11kg", "C 90x45").
3. TOTALS: Do NOT extract rows that are just totals/sums.
4. DATE: Convert to YYYY-MM-DD.

OUTPUT FORMAT (JSON ONLY):
{
  "vendor": "Shop Name",
  "bill_no": "Invoice #",
  "bill_date": "YYYY-MM-DD",
  "items": [
    { "raw_name": "Full Item description", "qty": 0.000, "rate": 0 }
  ]
}`;

    // STABLE ENDPOINT ANALYSIS:
    // We use v1beta but call 'gemini-1.5-flash-latest'. This is the specific 
    // version string that Google's public Free Tier requires to avoid 404s.
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`;

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: extractionPrompt },
            { inline_data: { mime_type: mimeType, data: base64Data } }
          ]
        }],
        generationConfig: {
          response_mime_type: "application/json",
          temperature: 0.1,
        }
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      // If 404 still occurs, try falling back to the 1.0 version path
      throw new Error(`Google API Error ${response.status}: ${errorText}`);
    }

    const resJson = await response.json();
    const aiText = resJson.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!aiText) throw new Error("AI could not extract text. Ensure the image is clear.");

    // Clean AI output to extract pure JSON
    let parsed: any;
    try {
      const cleanJson = aiText.substring(aiText.indexOf("{"), aiText.lastIndexOf("}") + 1);
      parsed = JSON.parse(cleanJson);
    } catch (e) {
      throw new Error("AI formatting error. Please upload a clearer image.");
    }

    // RUN THE SMART MATCHER
    const catalog = data.catalog ?? [];
    const processedItems = (parsed.items || []).map((it: any) => ({
      raw_name: String(it.raw_name),
      qty: Number(it.qty) || 0,
      rate: Number(it.rate) || 0,
      // Accuracy fix: Code matches dimensions better than AI does
      matched_item_id: solveSteelMatch(String(it.raw_name), catalog)
    }));

    return {
      vendor: parsed.vendor ?? null,
      bill_no: parsed.bill_no ?? null,
      bill_date: parsed.bill_date ?? null,
      items: processedItems
    };
  });
