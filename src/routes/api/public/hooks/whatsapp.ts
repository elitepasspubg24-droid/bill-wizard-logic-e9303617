import { createFileRoute } from "@tanstack/react-router";

// WhatsApp Cloud API webhook.
// A person on the approved list sends an item list (text or photo); the bot
// reads it, matches each line to the catalog and replies with available qty
// plus the last 3 purchases (date, party, rate).
export const Route = createFileRoute("/api/public/hooks/whatsapp")({
  server: {
    handlers: {
      // Meta's one-time webhook verification handshake
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const mode = url.searchParams.get("hub.mode");
        const token = url.searchParams.get("hub.verify_token");
        const challenge = url.searchParams.get("hub.challenge");
        if (mode === "subscribe" && token && token === process.env.WHATSAPP_VERIFY_TOKEN) {
          return new Response(challenge ?? "", { status: 200 });
        }
        return new Response("Forbidden", { status: 403 });
      },

      POST: async ({ request }) => {
        let payload: any = {};
        try {
          payload = await request.json();
        } catch {
          return new Response("ok");
        }

        try {
          await handleWebhook(payload);
        } catch (e) {
          // Always 200 so Meta does not retry-storm the endpoint.
          console.error("WhatsApp webhook error", e);
        }
        return new Response("ok");
      },
    },
  },
});

async function handleWebhook(payload: any) {
  const messages: any[] =
    payload?.entry?.flatMap((e: any) =>
      e?.changes?.flatMap((c: any) => c?.value?.messages ?? []) ?? [],
    ) ?? [];
  if (!messages.length) return;

  const [{ supabaseAdmin }, wa] = await Promise.all([
    import("@/integrations/supabase/client.server"),
    import("@/lib/whatsapp.server"),
  ]);

  for (const msg of messages) {
    const from: string = msg.from;
    if (!from) continue;

    const { data: allowed } = await supabaseAdmin
      .from("whatsapp_allowed_numbers")
      .select("phone");
    const ok = (allowed ?? []).some((a: any) => wa.phoneKey(a.phone) === wa.phoneKey(from));
    if (!ok) {
      await wa.sendWhatsAppText(
        from,
        "Sorry, this number is not authorised to use this service.",
      );
      continue;
    }

    let text: string | undefined;
    let media: { mimeType: string; base64: string } | undefined;

    if (msg.type === "text") text = msg.text?.body;
    else if (msg.type === "image") {
      media = await wa.fetchMediaDataUrl(msg.image.id);
      if (msg.image?.caption) text = msg.image.caption;
    } else if (msg.type === "document") {
      media = await wa.fetchMediaDataUrl(msg.document.id);
    } else {
      await wa.sendWhatsAppText(from, "Please send your item list as text or a photo.");
      continue;
    }

    if (!text && !media) continue;

    const [{ data: items }, { data: sections }, { data: aliases }] = await Promise.all([
      supabaseAdmin.from("items").select("id, name, section_id, available_qty, gauge_diff"),
      supabaseAdmin.from("sections").select("id, name"),
      supabaseAdmin.from("item_aliases").select("alias_key, item_id"),
    ]);

    const sectionMap = new Map((sections ?? []).map((s: any) => [s.id, s.name]));
    const itemMap = new Map((items ?? []).map((it: any) => [it.id, it]));

    // Category stock command: e.g. "angle stock", "flat stock", "pipe stock"
    if (text && !media) {
      const catMatch = text.trim().toLowerCase().match(/^([\w\s/]+?)\s+stock\s*$/);
      if (catMatch) {
        const reply = await handleCategoryStock(catMatch[1], items ?? [], sections ?? [], sectionMap, wa);
        await wa.sendWhatsAppText(from, reply);
        continue;
      }
    }

    const catalog = (items ?? []).map((it: any) => ({
      id: it.id,
      name: it.name,
      section: it.section_id ? sectionMap.get(it.section_id) ?? null : null,
    }));

    const lines = await wa.readEnquiry({ text, media }, catalog, aliases ?? []);
    if (!lines.length) {
      await wa.sendWhatsAppText(from, "I could not read any item from that. Please try again.");
      continue;
    }

    const blocks: string[] = [];
    let itemNumber = 0;

    for (const line of lines) {
      itemNumber++;
      const item = line.item_id ? itemMap.get(line.item_id) : null;
      if (!item) {
        blocks.push(`${itemNumber}. *${wa.formatItemName(line.raw_name)}*\nStock: Not found in our list.`);
        continue;
      }

      const { data: rows } = await supabaseAdmin
        .from("bill_items")
        .select("qty, rate, bills!inner(bill_date, created_at, vendor, type)")
        .eq("item_id", item.id);

      const purchases = ((rows ?? []) as any[])
        .filter((r) => r.bills?.type === "purchase" && Number(r.rate) > 0)
        .sort((a, b) => {
          const ka = new Date(a.bills.bill_date ?? a.bills.created_at).getTime();
          const kb = new Date(b.bills.bill_date ?? b.bills.created_at).getTime();
          return kb - ka;
        })
        .slice(0, 2);

      const hist = purchases.length
        ? purchases
            .map(
              (p) =>
                `      › ${wa.fmtDate(p.bills.bill_date ?? p.bills.created_at)} – ${
                  p.bills.vendor ?? "-"
                } – *${wa.fmtRate(p.rate)}*`,
            )
            .join("\n")
        : "› No purchase history";

      blocks.push(
        `${itemNumber}. *${wa.formatItemName(item.name)}*${item.section_id && sectionMap.get(item.section_id) ? ` (${sectionMap.get(item.section_id)})` : ""} | Stock: *${wa.fmtQty(
          item.available_qty,
        )}t* (${Number(item.gauge_diff ?? 0) >= 0 ? "+" : ""}${wa.fmtQty(Number(item.gauge_diff ?? 0))}rs)\n${hist}`,
      );
    }

    await wa.sendWhatsAppText(from, blocks.join("\n"));
  }
}

// Maps a user-typed keyword (e.g. "angle", "flat", "pipe") to section names.
const SECTION_KEYWORD_MAP: Record<string, string[]> = {
  angle: ["MS ANGLE", "ANGLE"],
  flat: ["MS FLAT", "FLAT"],
  channel: ["MS CHANNEL", "CHANNEL"],
  beam: ["I BEAM", "BEAM", "ISMB"],
  "sq bar": ["MS SQ BAR", "SQ BAR", "SQUARE BAR"],
  "round bar": ["MS ROUND BAR", "ROUND BAR", "ROUND"],
  round: ["MS ROUND BAR", "ROUND BAR", "ROUND"],
  plate: ["HR PLATE", "CHQ PLATE", "PLATE", "PLATE/SHEET", "SHEET"],
  "hr plate": ["HR PLATE", "PLATE/SHEET", "SHEET"],
  "chq plate": ["CHQ PLATE"],
  chequered: ["CHQ PLATE"],
  pipe: ["MS PIPE", "HEAVY PIPE", "PIPE"],
  "heavy pipe": ["HEAVY PIPE"],
};

async function handleCategoryStock(
  keyword: string,
  items: any[],
  sections: any[],
  sectionMap: Map<string, string>,
  wa: any,
): Promise<string> {
  const lower = keyword.trim().toLowerCase();
  const candidates = SECTION_KEYWORD_MAP[lower] ??
    Object.entries(SECTION_KEYWORD_MAP)
      .filter(([k]) => k.includes(lower) || lower.includes(k))
      .flatMap(([, v]) => v);

  if (!candidates.length) {
    return `Unknown category "${keyword}". Try: angle, flat, channel, beam, pipe, plate, round bar, sq bar, chq plate, heavy pipe.`;
  }

  const lowerCandidates = candidates.map((c) => c.toLowerCase());
  const matchedSections = sections.filter((s: any) => {
    const sn = s.name.trim().toLowerCase();
    return lowerCandidates.some((c) => sn === c || sn.includes(c));
  });

  if (!matchedSections.length) {
    return `No sections found for "${keyword}". Available: ${sections.map((s: any) => s.name).join(", ")}`;
  }

  const sectionIds = new Set(matchedSections.map((s: any) => s.id));
  const sectionItems = items
    .filter((it: any) => sectionIds.has(it.section_id))
    .sort((a: any, b: any) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true }));

  if (!sectionItems.length) {
    return `No items found in ${matchedSections.map((s: any) => s.name).join(", ")}.`;
  }

  const maxNameLen = Math.max(...sectionItems.map((it: any) => wa.formatItemName(it.name).length));
  const targetLen = Math.min(Math.max(maxNameLen + 2, 20), 36);

  const lines = sectionItems.map((it: any) => {
    const name = wa.formatItemName(it.name);
    const qty = `${wa.fmtQty(it.available_qty)}t`;
    const dots = ".".repeat(Math.max(3, targetLen - name.length - qty.length - 1));
    return `${name} ${dots} ${qty}`;
  });

  const total = sectionItems.reduce((sum: number, it: any) => sum + Number(it.available_qty || 0), 0);

  const header = `*${matchedSections.map((s: any) => s.name).join(" + ")} — Stock*`;
  const footer = `\nTotal: *${wa.fmtQty(total)}t* (${sectionItems.length} items)`;

  return [header, ...lines, footer].join("\n");
}
