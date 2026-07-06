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
    // 1. Switch to Groq API Key
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error("GROQ_API_KEY missing. Please add it to your Lovable environment variables.");
    }

    // 2. Validate format (Groq requires image files, not raw PDFs)
    const isPdf = data.dataUrl.startsWith("data:application/pdf");
    if (isPdf) {
      throw new Error(
        "Groq Vision models require image inputs (PNG, JPEG, WEBP). Please upload or convert your bill to an image format."
      );
    }

    // Cap catalog size to keep prompt small; the AI only needs enough to match.
    const catalog = (data.catalog ?? []).slice(0, 600);
    const catalogText = catalog.length
      ? catalog
          .map(
            (c) =>
              `${c.id} | ${c.name}${c.section ? ` [${c.section}]` : ""}`,
          )
          .join("\n")
      : "(no catalog provided)";

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
${catalogText}`;

    // 3. Structure OpenAI/Groq compatible multimodal user content payload
    const userContent = [
      {
        type: "text",
        text: `Extract this ${data.type} bill. Follow the rules exactly. Return JSON: {"vendor":..., "bill_no":..., "bill_date":..., "items":[{"raw_name":..., "qty":..., "rate":..., "matched_item_id":...}]}`,
      },
      {
        type: "image_url",
        image_url: {
          url: data.dataUrl, // Accepts data:image/jpeg;base64,... etc.
        },
      },
    ];

    // 4. Send request directly to Groq API endpoint
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "llama-3.2-11b-vision-preview", // Free tier high-speed vision model
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        response_format: { type: "json_object" }, // Forces structured output JSON mode
        temperature: 0.1, // Keeps extractions deterministic and accurate
      }),
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Groq extraction failed: ${res.status} ${txt.slice(0, 200)}`);
    }

    const json = await res.json();
    let raw = json.choices?.[0]?.message?.content ?? "{}";
    
    // Defensive sanitization: Clean markdown fences if the model wraps them accidentally
    if (raw.startsWith("```json")) {
      raw = raw.replace(/^```json\s*/, "").replace(/\s*```$/, "");
    } else if (raw.startsWith("```")) {
      raw = raw.replace(/^```\s*/, "").replace(/\s*```$/, "");
    }

    let parsed: ExtractedBill;
    try {
      parsed = JSON.parse(raw.trim());
    } catch {
      throw new Error("Groq returned non-parseable JSON: " + raw.slice(0, 200));
    }

    const validIds = new Set(catalog.map((c) => c.id));
    const items = Array.isArray(parsed.items) ? parsed.items : [];
    
    return {
      vendor: parsed.vendor ?? null,
      bill_no: parsed.bill_no ?? null,
      bill_date: parsed.bill_date ?? null,
      items: items.map((it) => ({
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
