import { supabase } from "@/integrations/supabase/client";

/**
 * Sort key for a bill: prefer bill_date (day precision), fall back to created_at.
 * Returns a comparable number (ms). Newest first when sorted descending.
 */
export function billSortKey(bill: { bill_date?: string | null; created_at?: string | null }) {
  const d = bill?.bill_date ? new Date(`${bill.bill_date}T00:00:00`).getTime() : NaN;
  const c = bill?.created_at ? new Date(bill.created_at).getTime() : NaN;
  const primary = Number.isNaN(d) ? (Number.isNaN(c) ? 0 : c) : d;
  const secondary = Number.isNaN(c) ? 0 : c;
  return { primary, secondary };
}

function compareNewestFirst(a: any, b: any) {
  const ka = billSortKey(a?.bills ?? a);
  const kb = billSortKey(b?.bills ?? b);
  if (kb.primary !== ka.primary) return kb.primary - ka.primary;
  return kb.secondary - ka.secondary;
}

export type LedgerEntry = {
  id: string;
  qty: number;
  rate: number;
  bills: {
    id: string;
    bill_date: string | null;
    created_at: string;
    vendor: string | null;
    type: string;
    notes: string | null;
  };
};

/**
 * Full movement ledger for an item, newest first.
 * NOTE: PostgREST cannot order parent rows by an embedded to-one table, so we
 * always sort client-side — ordering by `referencedTable` silently returns rows
 * in an arbitrary order and truncates the wrong ones when combined with limit().
 */
export async function fetchItemLedger(itemId: string, limit?: number): Promise<LedgerEntry[]> {
  const { data, error } = await supabase
    .from("bill_items")
    .select("id, qty, rate, bills!inner(id, bill_date, created_at, vendor, type, notes)")
    .eq("item_id", itemId);
  if (error) throw error;
  const rows = ((data ?? []) as any[]).slice().sort(compareNewestFirst);
  return (limit ? rows.slice(0, limit) : rows) as LedgerEntry[];
}

/** Purchase history (vendor / date / rate) for an item, newest first. */
export async function fetchItemPurchaseHistory(itemId: string, limit?: number) {
  const rows = await fetchItemLedger(itemId);
  const purchases = rows.filter((r) => r.bills.type === "purchase");
  const mapped = purchases.map((r) => ({
    vendor_name: r.bills.vendor,
    purchase_date: r.bills.bill_date ?? r.bills.created_at,
    rate: r.rate,
    qty: r.qty,
  }));
  return limit ? mapped.slice(0, limit) : mapped;
}

/** Signed stock effect of a bill line, based on bill type. */
export function stockDelta(type: string, qty: number) {
  if (type === "purchase") return qty;
  if (type === "sale") return -Math.abs(qty);
  // suspense / adjustments carry their own sign
  return qty;
}

/**
 * Recomputes available_qty and last_purchase_rate for an item from the full
 * bill history (single source of truth) and writes them back to `items`.
 */
export async function syncItemStockAndRate(itemId: string) {
  const rows = await fetchItemLedger(itemId);

  const newQty = rows.reduce(
    (acc, r) => acc + stockDelta(r.bills.type, Number(r.qty || 0)),
    0,
  );

  // rows are already newest-first, so the first positive-rate purchase is the latest
  const latest = rows.find((r) => r.bills.type === "purchase" && Number(r.rate) > 0);
  const lastRate = latest ? Number(latest.rate) : null;

  const { error } = await supabase
    .from("items")
    .update({
      available_qty: Number(newQty.toFixed(3)),
      last_purchase_rate: lastRate,
    })
    .eq("id", itemId);
  if (error) throw error;

  return { available_qty: newQty, last_purchase_rate: lastRate };
}

/** Resync many items sequentially (avoids hammering the DB). */
export async function syncItems(itemIds: string[]) {
  for (const id of Array.from(new Set(itemIds.filter(Boolean)))) {
    await syncItemStockAndRate(id);
  }
}

/**
 * Recomputes a sauda's lifted_qty from its uplift rows and updates status.
 * Call after any uplift is added/removed (e.g. when a linked bill is deleted).
 */
export async function recomputeSaudaLifted(saudaId: string) {
  const [{ data: sauda }, { data: ups }] = await Promise.all([
    supabase.from("saudas").select("id, total_qty").eq("id", saudaId).maybeSingle(),
    supabase.from("sauda_uplifts").select("qty").eq("sauda_id", saudaId),
  ]);
  if (!sauda) return;

  const lifted = (ups ?? []).reduce((a, u) => a + Number(u.qty || 0), 0);
  const total = Number(sauda.total_qty || 0);
  const clamped = Math.max(0, total > 0 ? Math.min(total, lifted) : lifted);

  await supabase
    .from("saudas")
    .update({
      lifted_qty: Number(clamped.toFixed(3)),
      status: total > 0 && clamped >= total ? "done" : "open",
    })
    .eq("id", saudaId);
}
