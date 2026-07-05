import { createFileRoute } from "@tanstack/react-router";

const GATEWAY = "https://connector-gateway.lovable.dev/google_sheets/v4";

const TABS = [
  "Factory Rates",
  "Sections",
  "Items",
  "Bills",
  "Bill Items",
  "Saudas",
  "Sauda Items",
  "Sauda Uplifts",
] as const;

async function sheetsFetch(path: string, init: RequestInit = {}) {
  const r = await fetch(`${GATEWAY}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.LOVABLE_API_KEY}`,
      "X-Connection-Api-Key": process.env.GOOGLE_SHEETS_API_KEY!,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Sheets ${path} ${r.status}: ${t.slice(0, 300)}`);
  }
  return r.json();
}

function fmtDate(v: string | null | undefined) {
  return v ? String(v).slice(0, 10) : "";
}
function fmtTs(v: string | null | undefined) {
  return v ? String(v).replace("T", " ").slice(0, 19) : "";
}

export const Route = createFileRoute("/api/public/hooks/sync-sheets")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apikey = request.headers.get("apikey");
        if (apikey !== process.env.SUPABASE_PUBLISHABLE_KEY) {
          return new Response("Unauthorized", { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // 1. Fetch everything
        const [
          settingsRes,
          factoriesRes,
          sectionsRes,
          itemsRes,
          billsRes,
          billItemsRes,
          saudasRes,
          saudaItemsRes,
          upliftsRes,
        ] = await Promise.all([
          supabaseAdmin.from("app_settings").select("*").eq("id", "global").maybeSingle(),
          supabaseAdmin.from("factories").select("*").order("position"),
          supabaseAdmin.from("sections").select("*").order("position"),
          supabaseAdmin.from("items").select("*").order("position"),
          supabaseAdmin.from("bills").select("*").order("bill_date", { ascending: false }),
          supabaseAdmin.from("bill_items").select("*"),
          supabaseAdmin.from("saudas").select("*").order("sauda_date", { ascending: false }),
          supabaseAdmin.from("sauda_items").select("*"),
          supabaseAdmin.from("sauda_uplifts").select("*").order("created_at", { ascending: false }),
        ]);

        const factories = factoriesRes.data ?? [];
        const sections = sectionsRes.data ?? [];
        const items = itemsRes.data ?? [];
        const bills = billsRes.data ?? [];
        const billItems = billItemsRes.data ?? [];
        const saudas = saudasRes.data ?? [];
        const saudaItems = saudaItemsRes.data ?? [];
        const uplifts = upliftsRes.data ?? [];

        const facById = new Map(factories.map((f: any) => [f.id, f]));
        const secById = new Map(sections.map((s: any) => [s.id, s]));
        const itemById = new Map(items.map((i: any) => [i.id, i]));
        const billById = new Map(bills.map((b: any) => [b.id, b]));
        const saudaById = new Map(saudas.map((s: any) => [s.id, s]));

        // 2. Ensure spreadsheet exists
        let spreadsheetId: string | null = settingsRes.data?.sheets_spreadsheet_id ?? null;
        let spreadsheetUrl: string | null = null;

        if (!spreadsheetId) {
          const created = await sheetsFetch(`/spreadsheets`, {
            method: "POST",
            body: JSON.stringify({
              properties: { title: "Steel Rate Manager — Data Sync" },
              sheets: TABS.map((title, idx) => ({
                properties: { title, index: idx, gridProperties: { frozenRowCount: 1 } },
              })),
            }),
          });
          spreadsheetId = created.spreadsheetId;
          spreadsheetUrl = created.spreadsheetUrl;
          await supabaseAdmin
            .from("app_settings")
            .update({ sheets_spreadsheet_id: spreadsheetId })
            .eq("id", "global");
        } else {
          // Make sure all expected tabs exist (add any missing)
          const meta = await sheetsFetch(`/spreadsheets/${spreadsheetId}`);
          spreadsheetUrl = meta.spreadsheetUrl;
          const existing = new Set<string>(
            (meta.sheets ?? []).map((s: any) => s.properties.title),
          );
          const missing = TABS.filter((t) => !existing.has(t));
          if (missing.length) {
            await sheetsFetch(`/spreadsheets/${spreadsheetId}:batchUpdate`, {
              method: "POST",
              body: JSON.stringify({
                requests: missing.map((title) => ({
                  addSheet: {
                    properties: { title, gridProperties: { frozenRowCount: 1 } },
                  },
                })),
              }),
            });
          }
        }

        // 3. Build the tab data
        const tabs: Record<string, (string | number)[][]> = {};

        tabs["Factory Rates"] = [
          [
            "Factory",
            "Basic Rate",
            "Adder",
            "Today's Rate",
            "Party Adder",
            "Party Rate",
            "Sauda W",
            "W Adder",
            "Updated At",
          ],
          ...factories.map((f: any) => {
            const basic = Number(f.basic_rate ?? 0);
            const adder = Number(f.adder ?? 0);
            const padd = Number(f.party_adder ?? 0);
            return [
              f.name,
              basic,
              adder,
              basic + adder,
              padd,
              basic + adder + padd,
              f.w ?? "",
              f.w_adder ?? "",
              fmtTs(f.updated_at),
            ];
          }),
        ];

        tabs["Sections"] = [
          ["Factory", "Section", "Adder", "Sauda Basic", "Party Basic"],
          ...sections.map((s: any) => [
            facById.get(s.factory_id)?.name ?? "",
            s.name,
            Number(s.adder ?? 0),
            Number(s.sauda_basic ?? 0),
            Number(s.party_basic ?? 0),
          ]),
        ];

        tabs["Items"] = [
          [
            "Factory",
            "Section",
            "Item",
            "Available Qty",
            "Gauge Diff",
            "% Adder",
            "Last Purchase Rate",
          ],
          ...items.map((i: any) => {
            const sec = secById.get(i.section_id);
            const fac = sec ? facById.get(sec.factory_id) : null;
            return [
              fac?.name ?? "",
              sec?.name ?? "",
              i.name,
              Number(i.available_qty ?? 0),
              Number(i.gauge_diff ?? 0),
              Number(i.percentage_adder ?? 0),
              i.last_purchase_rate ?? "",
            ];
          }),
        ];

        tabs["Bills"] = [
          ["Date", "Type", "Vendor", "Bill No", "Status", "Notes", "Created At"],
          ...bills.map((b: any) => [
            fmtDate(b.bill_date),
            b.type,
            b.vendor ?? "",
            b.bill_no ?? "",
            b.status,
            b.notes ?? "",
            fmtTs(b.created_at),
          ]),
        ];

        tabs["Bill Items"] = [
          ["Bill Date", "Type", "Vendor", "Bill No", "Item", "Raw Name", "Qty", "Rate", "Amount"],
          ...billItems.map((bi: any) => {
            const b = billById.get(bi.bill_id) as any;
            const item = bi.item_id ? itemById.get(bi.item_id) : null;
            const qty = Number(bi.qty ?? 0);
            const rate = Number(bi.rate ?? 0);
            return [
              b ? fmtDate(b.bill_date) : "",
              b?.type ?? "",
              b?.vendor ?? "",
              b?.bill_no ?? "",
              (item as any)?.name ?? "",
              bi.raw_name ?? "",
              qty,
              rate,
              qty * rate,
            ];
          }),
        ];

        tabs["Saudas"] = [
          [
            "Date",
            "Party",
            "Factory",
            "Sauda Basic",
            "Total Qty",
            "Lifted Qty",
            "Remaining",
            "Status",
            "Completed At",
            "Notes",
          ],
          ...saudas.map((s: any) => {
            const total = Number(s.total_qty ?? 0);
            const lifted = Number(s.lifted_qty ?? 0);
            return [
              fmtDate(s.sauda_date),
              s.party_name,
              facById.get(s.factory_id)?.name ?? "",
              Number(s.sauda_basic ?? 0),
              total,
              lifted,
              total - lifted,
              s.status,
              fmtTs(s.completed_at),
              s.notes ?? "",
            ];
          }),
        ];

        tabs["Sauda Items"] = [
          ["Sauda Date", "Party", "Item", "Raw Name", "Qty", "Rate"],
          ...saudaItems.map((si: any) => {
            const s = saudaById.get(si.sauda_id) as any;
            const it = si.item_id ? itemById.get(si.item_id) : null;
            return [
              s ? fmtDate(s.sauda_date) : "",
              s?.party_name ?? "",
              (it as any)?.name ?? "",
              si.raw_name ?? "",
              Number(si.qty ?? 0),
              Number(si.rate ?? 0),
            ];
          }),
        ];

        tabs["Sauda Uplifts"] = [
          ["When", "Party", "Sauda Date", "Qty", "Kind", "Note"],
          ...uplifts.map((u: any) => {
            const s = saudaById.get(u.sauda_id) as any;
            return [
              fmtTs(u.created_at),
              s?.party_name ?? "",
              s ? fmtDate(s.sauda_date) : "",
              Number(u.qty ?? 0),
              u.kind,
              u.note ?? "",
            ];
          }),
        ];

        // 4. Clear + write each tab
        for (const tab of TABS) {
          const rows = tabs[tab];
          await sheetsFetch(
            `/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(tab)}:clear`,
            { method: "POST", body: "{}" },
          );
          await sheetsFetch(
            `/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
              `${tab}!A1`,
            )}?valueInputOption=RAW`,
            { method: "PUT", body: JSON.stringify({ values: rows }) },
          );
        }

        await supabaseAdmin
          .from("app_settings")
          .update({ sheets_last_sync_at: new Date().toISOString() })
          .eq("id", "global");

        return Response.json({
          ok: true,
          spreadsheetId,
          spreadsheetUrl,
          synced_at: new Date().toISOString(),
          rows: Object.fromEntries(
            Object.entries(tabs).map(([k, v]) => [k, v.length - 1]),
          ),
        });
      },
    },
  },
});
