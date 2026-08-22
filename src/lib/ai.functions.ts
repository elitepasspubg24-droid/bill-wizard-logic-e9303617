import { createServerFn } from "@tanstack/react-start";
import { aliasKey, buildIndex, matchItem } from "@/lib/item-match";

export type ExtractedBillItem = { //[cite: 1]
  raw_name: string; //[cite: 1]
  qty: number; //[cite: 1]
  rate: number; //[cite: 1]
  matched_item_id?: string | null; //[cite: 1]
}; //[cite: 1]

export type ExtractedBill = { //[cite: 1]
  vendor: string | null; //[cite: 1]
  bill_no: string | null; //[cite: 1]
  bill_date: string | null; //[cite: 1]
  items: ExtractedBillItem[]; //[cite: 1]
}; //[cite: 1]

export type CatalogItem = { id: string; name: string; section?: string | null };
export type ItemAlias = { alias_key: string; item_id: string };

export const extractBillFromImage = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      dataUrl: string;
      type: "purchase" | "sale";
      catalog?: CatalogItem[];
      aliases?: ItemAlias[];
    }) => data,
  )
  .handler(async ({ data }): Promise<ExtractedBill> => { //[cite: 1]
    // Get your free Gemini API Key from Google AI Studio
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY missing. Please add it to your Lovable environment variables.");
    }

    // Safely extract the raw base64 string and mimeType out of the browser's dataUrl
    const match = data.dataUrl.match(/^data:(.*?);base64,(.*)$/);
    if (!match) {
      throw new Error("Invalid document data URL format received.");
    }
    const mimeType = match[1];
    const base64Data = match[2];

    // Catalog is NOT sent to the model any more — matching is done locally below.
    // That removes thousands of prompt tokens per scan (the main latency cost)
    // and makes matching deterministic instead of a guess.
    const catalog = (data.catalog ?? []).slice(0, 5000);

    const systemPrompt = `You extract structured data from Indian steel/iron trading bills and handwritten enquiry slips. Reply with a single JSON object only. No markdown, no commentary.

FIELDS
- vendor: party/shop name at top of the slip (string|null)
- bill_no: bill number if visible (string|null)
- bill_date: YYYY-MM-DD (Indian slips use DD/MM/YYYY — convert)
- items: array of {raw_name, qty, rate}

RULES
1. Read every line in the items section. Do not skip lines.
2. raw_name = the item description exactly as written, cleaned (e.g. "C 90x45 (S.L)", "38x38x11kg", "2x1x15kg", "25 OD x 1.00mm", "HR PLATE 4x8 6mm"). ALWAYS keep size, thickness/gauge in mm, and weight-per-piece in kg.
3. qty = the number on the right of the line, kept exactly as written (handwritten slips use tonnes like 0.360). Skip a totals/sum row joined by a bracket.
4. rate = per-unit rate if written, else 0. Never invent a rate.
5. Ignore signatures, phone/vehicle numbers, stamps, page numbers.

NOTATION
- "C 90x45" = Channel 90x45 ; "L 50x50x5" = Angle 50x50x5mm
- "38x38x11kg" = 38x38 square pipe, 11 kg/pc ; "2x1x15kg" = 2"x1" rectangular pipe, 15 kg/pc
- "25 OD x 1.00mm" = 25 OD round pipe, 1.00 mm thick ; "(S.L)" = Standard Length, keep it`;

    const userPrompt = `Extract this ${data.type} bill. Return JSON: {"vendor":..., "bill_no":..., "bill_date":..., "items":[{"raw_name":..., "qty":..., "rate":...}]}`;


    // Construct the direct native Google Gemini REST API request payload
    const requestBody = {
      systemInstruction: {
        parts: [{ text: systemPrompt }]
      },
      contents: [
        {
          role: "user",
          parts: [
            { text: userPrompt },
            {
              inlineData: {
                mimeType: mimeType, // Automatically handles image/png, image/jpeg, application/pdf, etc.
                data: base64Data
              }
            }
          ]
        }
      ],
      generationConfig: {
        responseMimeType: "application/json", // Forces strict native structured JSON output layout
        temperature: 0,
        maxOutputTokens: 2048,
        // Disable "thinking" — biggest latency win, extraction needs no reasoning budget
        thinkingConfig: { thinkingBudget: 0 }
      }
    };

    // Post data directly to Google's official endpoints
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody)
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Direct Gemini API call failed: ${res.status} ${txt.slice(0, 200)}`);
    }

    const responseJson = await res.json();
    
    // Parse Google's specific response layout structure
    const raw = responseJson.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";

    let parsed: ExtractedBill; //[cite: 1]
    try {
      parsed = JSON.parse(raw.trim());
    } catch {
      throw new Error("Gemini returned non-parseable JSON: " + raw.slice(0, 200));
    }

    const items = Array.isArray(parsed.items) ? parsed.items : [];
    const index = buildIndex(catalog);

    return {
      vendor: parsed.vendor ?? null,
      bill_no: parsed.bill_no ?? null,
      bill_date: parsed.bill_date ?? null,
      items: items.map((it) => {
        const raw_name = String(it.raw_name ?? "");
        return {
          raw_name,
          qty: Number(it.qty) || 0,
          rate: Number(it.rate) || 0,
          matched_item_id: matchItem(raw_name, index),
        };
      }),
    };
  });
