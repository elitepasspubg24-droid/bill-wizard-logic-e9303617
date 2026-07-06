import { createServerFn } from "@tanstack/react-start"; //[cite: 1]

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

export type CatalogItem = { id: string; name: string; section?: string | null }; //[cite: 1]

export const extractBillFromImage = createServerFn({ method: "POST" }) //[cite: 1]
  .inputValidator( //[cite: 1]
    (data: { //[cite: 1]
      dataUrl: string; //[cite: 1]
      type: "purchase" | "sale"; //[cite: 1]
      catalog?: CatalogItem[]; //[cite: 1]
    }) => data, //[cite: 1]
  ) //[cite: 1]
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

    // Cap catalog size to keep prompt within bounds
    const catalog = (data.catalog ?? []).slice(0, 600); //[cite: 1]
    const catalogText = catalog.length //[cite: 1]
      ? catalog //[cite: 1]
          .map( //[cite: 1]
            (c) => //[cite: 1]
              `${c.id} | ${c.name}${c.section ? ` [${c.section}]` : ""}`, //[cite: 1]
          ) //[cite: 1]
          .join("\n") //[cite: 1]
      : "(no catalog provided)"; //[cite: 1]

    const systemPrompt = `You extract structured data from Indian steel/iron trading bills. These are often HANDWRITTEN sale slips on a small pad, or printed purchase invoices. Reply with a single JSON object only. No markdown, no commentary.

FIELDS
- vendor: party/shop name at top of the slip (string|null)
- bill_no: bill number if visible (string|null)
- bill_date: YYYY-MM-DD. Indian slips use DD/MM/YYYY or DD|MM|YYYY — convert.
- items: array of {raw_name, qty, rate, matched_item_id}

RULES FOR ITEMS
1. Read every line in the items section. Do not skip lines.
2. raw_name = the full item description as written, cleaned up (e.g. "C 90x45 (S.L)", "38x38x11kg", "2x1x15kg", "25 OD x 1.00mm", "HR PLATE 4x8 6mm"). Preserve size, thickness/gauge, and weight-per-piece written in brackets or after the size.
3. qty is the NUMBER written on the right side of that line. In handwritten sale slips this is almost always in METRIC TONNES written as a decimal like 0.360, 0.220, 0.230 — keep it exactly as written (0.360, not 360). Do NOT include a totals/sum row (a line like "0.810" that is the sum of the rows above — usually with a bracket/curly brace joining them — is the total, skip it).
4. rate: per-unit rate if written on the line. Handwritten sale slips usually DO NOT have per-item rates — set rate to 0 in that case. Do not invent a rate.
5. Ignore signatures, phone numbers, vehicle numbers (like "MH40 / N3418"), stamps, and page numbers.

STEEL NOTATION HINTS
- "C 90x45" = Channel 90x45
- "L 50x50x5" = Angle 50x50x5mm
- "38x38x11kg" or "38x38 (11kg)" = 38x38 SQUARE pipe, 11 kg per piece
- "2x1x15kg" = 2"x1" RECTANGULAR pipe, 15 kg per piece
- "25 OD x 1.00mm" = 25 OD round pipe, 1.00 mm thickness
- "(S.L)" / "(sl)" = Standard Length — keep it in raw_name

ITEM MATCHING
You are given a CATALOG of known items (id | name [section]). For each extracted line, set matched_item_id to the catalog id that best matches raw_name based on size, thickness, gauge, and weight-per-piece. Prefer exact size + weight matches. If no confident match, set matched_item_id to null.

CATALOG:
${catalogText}`; //[cite: 1]

    const userPrompt = `Extract this ${data.type} bill. Follow the rules exactly. Return JSON: {"vendor":..., "bill_no":..., "bill_date":..., "items":[{"raw_name":..., "qty":..., "rate":..., "matched_item_id":...}]}`; //[cite: 1]

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
        responseMimeType: "application/json" // Forces strict native structured JSON output layout
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

    const validIds = new Set(catalog.map((c) => c.id)); //[cite: 1]
    const items = Array.isArray(parsed.items) ? parsed.items : []; //[cite: 1]
    
    return {
      vendor: parsed.vendor ?? null, //[cite: 1]
      bill_no: parsed.bill_no ?? null, //[cite: 1]
      bill_date: parsed.bill_date ?? null, //[cite: 1]
      items: items.map((it) => ({
        raw_name: String(it.raw_name ?? ""), //[cite: 1]
        qty: Number(it.qty) || 0, //[cite: 1]
        rate: Number(it.rate) || 0, //[cite: 1]
        matched_item_id: //[cite: 1]
          it.matched_item_id && validIds.has(it.matched_item_id) //[cite: 1]
            ? it.matched_item_id //[cite: 1]
            : null, //[cite: 1]
      })),
    };
  });
