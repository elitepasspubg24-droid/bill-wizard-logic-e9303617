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
    const catalog = (items ?? []).map((it: any) => ({
      id: it.id,
      name: it.name,
      section: it.section_id ? sectionMap.get(it.section_id) ?? null : null,
    }));
    const itemMap = new Map((items ?? []).map((it: any) => [it.id, it]));

    const lines = await wa.readEnquiry({ text, media }, catalog, aliases ?? []);
    if (!lines.length) {
      await wa.sendWhatsAppText(from, "I could not read any item from that. Please try again.");
      continue;
    }

    const blocks: string[] = ["*AVAILABLE QTY AND PURCHASE RATE*\n"];
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
                `     › ${wa.fmtDate(p.bills.bill_date ?? p.bills.created_at)} – ${
                  p.bills.vendor ?? "-"
                } – ${wa.fmtRate(p.rate)}`,
            )
            .join("\n")
        : "› No purchase history";

      blocks.push(
        `${itemNumber}. *${wa.formatItemName(item.name)}*${item.section_id && sectionMap.get(item.section_id) ? ` (${sectionMap.get(item.section_id)})` : ""} | Stock: ${wa.fmtQty(
          item.available_qty,
        )} (${Number(item.gauge_diff ?? 0) >= 0 ? "+" : ""}${wa.fmtQty(Number(item.gauge_diff ?? 0))})\n${hist}`,
      );
    }

    await wa.sendWhatsAppText(from, blocks.join("\n"));
  }
}
