--- START OF FILE bill-wizard-logic-e9303617-main/src/routes/_app.bills.tsx ---
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, useMemo } from "react";
import { fetchBills, fetchItems, fetchSaudas, fetchSections } from "@/lib/queries";
import { ItemPicker } from "@/components/ItemPicker";
import { supabase } from "@/integrations/supabase/client";
import { extractBillFromImage, type ExtractedBill } from "@/lib/ai.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Pencil, Trash2, Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/bills")({
  component: BillsPage,
  head: () => ({ meta: [{ title: "Bills & Inventory" }] }),
});

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

// ─── Edit Dialog ────────────────────────────────────────────────────────────

function EditBillDialog({
  bill,
  items,
  sections,
  open,
  onClose,
}: {
  bill: any;
  items: any[];
  sections: any[];
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [vendor, setVendor] = useState(bill.vendor ?? "");
  const [billNo, setBillNo] = useState(bill.bill_no ?? "");
  const [billDate, setBillDate] = useState(bill.bill_date ?? "");
  const [billItems, setBillItems] = useState<any[]>(
    (bill.bill_items ?? []).map((bi: any) => ({ ...bi }))
  );

  const totalQty = useMemo(() => {
    return billItems.reduce((sum, item) => sum + (Number(item.qty) || 0), 0);
  }, [billItems]);

  const mut = useMutation({
    mutationFn: async () => {
      // 1. Get original items to calculate deltas
      const { data: originalItems } = await supabase
        .from("bill_items")
        .select("*")
        .eq("bill_id", bill.id);

      // Update bill header
      const { error: be } = await supabase
        .from("bills")
        .update({ vendor, bill_no: billNo, bill_date: billDate })
        .eq("id", bill.id);
      if (be) throw be;

      // 2. Revert old stock changes
      if (originalItems) {
        for (const old of originalItems) {
          if (!old.item_id) continue;
          const { data: it } = await supabase.from("items").select("available_qty").eq("id", old.item_id).single();
          if (it) {
            const adjustment = bill.type === "purchase" ? -Number(old.qty) : Number(old.qty);
            await supabase.from("items").update({ available_qty: Number(it.available_qty) + adjustment }).eq("id", old.item_id);
          }
        }
      }

      // 3. Update the bill_items table rows
      for (const bi of billItems) {
        if (bi.id) {
          const { error } = await supabase
            .from("bill_items")
            .update({ qty: Number(bi.qty), rate: Number(bi.rate), item_id: bi.item_id })
            .eq("id", bi.id);
          if (error) throw error;
        }
      }

      // 4. Apply new stock changes and refresh Last Purchase Rates
      for (const current of billItems) {
        if (!current.item_id) continue;
        const { data: it } = await supabase.from("items").select("available_qty").eq("id", current.item_id).single();
        if (it) {
          const adjustment = bill.type === "purchase" ? Number(current.qty) : -Number(current.qty);
          const updatePayload: any = { available_qty: Number(it.available_qty) + adjustment };
          
          if (bill.type === "purchase") {
             const { data: latest } = await supabase
               .from("bill_items")
               .select("rate, bills!inner(bill_date)")
               .eq("item_id", current.item_id)
               .order("bill_date", { referencedTable: 'bills', ascending: false })
               .limit(1);
             if (latest?.[0]) updatePayload.last_purchase_rate = latest[0].rate;
          }
          await supabase.from("items").update(updatePayload).eq("id", current.item_id);
        }
      }
    },
    onSuccess: () => {
      toast.success("Bill and Inventory updated");
      qc.invalidateQueries({ queryKey: ["bills"] });
      qc.invalidateQueries({ queryKey: ["items"] });
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col p-0 overflow-hidden">
        <DialogHeader className="p-6 pb-2">
          <DialogTitle>Edit Bill</DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto px-6 py-2 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div><Label>Vendor</Label><Input value={vendor} onChange={(e) => setVendor(e.target.value)} /></div>
            <div><Label>Bill No</Label><Input value={billNo} onChange={(e) => setBillNo(e.target.value)} /></div>
            <div><Label>Bill Date</Label><Input type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} /></div>
          </div>
          {billItems.length > 0 && (
            <div className="overflow-x-auto border rounded-md">
              <table className="w-full text-sm min-w-[600px]">
                <thead className="bg-muted/50 border-b text-left sticky top-0 z-10">
                  <tr>
                    <th className="p-2">Raw Name</th>
                    <th className="p-2">Match Item</th>
                    <th className="p-2 w-28">Qty (MT)</th>
                    <th className="p-2 w-32">Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {billItems.map((bi, i) => (
                    <tr key={bi.id} className="border-b last:border-0">
                      <td className="p-2 text-muted-foreground italic text-xs max-w-[150px] truncate">{bi.raw_name}</td>
                      <td className="p-2">
                        <ItemPicker
                          items={items}
                          sections={sections}
                          value={bi.item_id}
                          onChange={(id) => {
                            const updated = [...billItems];
                            updated[i] = { ...updated[i], item_id: id };
                            setBillItems(updated);
                          }}
                          width="w-full"
                        />
                      </td>
                      <td className="p-2">
                        <Input 
                          type="number" 
                          step="0.001"
                          value={bi.qty} 
                          onChange={(e) => {
                            const updated = [...billItems];
                            updated[i] = { ...updated[i], qty: e.target.value };
                            setBillItems(updated);
                          }} 
                          className="font-mono h-10 text-base sm:text-sm"
                        />
                      </td>
                      <td className="p-2">
                        <Input 
                          type="number" 
                          value={bi.rate} 
                          onChange={(e) => {
                            const updated = [...billItems];
                            updated[i] = { ...updated[i], rate: e.target.value };
                            setBillItems(updated);
                          }} 
                          className="font-mono h-10 text-base sm:text-sm"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-muted/30 font-bold border-t">
                  <tr>
                    <td colSpan={2} className="p-3 text-right uppercase tracking-wider text-xs">Total Quantity</td>
                    <td className="p-3 font-mono text-base text-primary">{totalQty.toFixed(3)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
        <DialogFooter className="p-6 pt-2 border-t bg-muted/10">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending ? <Loader2 className="animate-spin mr-2" /> : null}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Delete Confirm Dialog ───────────────────────────────────────────────────

function DeleteBillDialog({
  bill,
  open,
  onClose,
}: {
  bill: any;
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();

  const mut = useMutation({
    mutationFn: async () => {
      const { data: billItems } = await supabase.from("bill_items").select("*").eq("bill_id", bill.id);

      if (billItems?.length) {
        for (const bi of billItems) {
          if (!bi.item_id) continue;
          const { data: item } = await supabase.from("items").select("available_qty").eq("id", bi.item_id).single();
          if (!item) continue;
          
          const qty = Number(bi.qty) || 0;
          const newQty = bill.type === "purchase" ? Number(item.available_qty) - qty : Number(item.available_qty) + qty;
          
          const updatePayload: any = { available_qty: newQty };

          if (bill.type === "purchase") {
            const { data: nextLatest } = await supabase
              .from("bill_items")
              .select("rate")
              .eq("item_id", bi.item_id)
              .neq("bill_id", bill.id) 
              .order("id", { ascending: false })
              .limit(1);
            updatePayload.last_purchase_rate = nextLatest?.[0]?.rate ?? null;
          }

          await supabase.from("items").update(updatePayload).eq("id", bi.item_id);
        }
      }

      await supabase.from("bill_items").delete().eq("bill_id", bill.id);
      const { error } = await supabase.from("bills").delete().eq("id", bill.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Bill deleted and stock reversed");
      qc.invalidateQueries({ queryKey: ["bills"] });
      qc.invalidateQueries({ queryKey: ["items"] });
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Bill?</AlertDialogTitle>
          <AlertDialogDescription>
            Permanently delete bill <strong>{bill.bill_no ?? bill.id.slice(0, 8)}</strong>
            {bill.vendor ? ` from ${bill.vendor}` : ""} and <strong>reverse</strong> stock changes.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onClose}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => mut.mutate()} disabled={mut.isPending} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
            {mut.isPending ? "Deleting…" : "Yes, Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ─── Main Bills Page ─────────────────────────────────────────────────────────

function BillsPage() {
  const qc = useQueryClient();
  const bills = useQuery({ queryKey: ["bills"], queryFn: fetchBills });
  const items = useQuery({ queryKey: ["items"], queryFn: fetchItems });
  const sections = useQuery({ queryKey: ["sections"], queryFn: fetchSections });
  const saudas = useQuery({ queryKey: ["saudas"], queryFn: fetchSaudas });
  const extract = useServerFn(extractBillFromImage);

  const [type, setType] = useState<"purchase" | "sale">("purchase");
  const [file, setFile] = useState<File | null>(null);
  const [draft, setDraft] = useState<ExtractedBill | null>(null);
  const [busy, setBusy] = useState(false);
  const [matches, setMatches] = useState<(string | null)[]>([]);
  const [linkSaudaId, setLinkSaudaId] = useState<string>("none");
  const [skipUpload, setSkipUpload] = useState(true);

  const [editBill, setEditBill] = useState<any | null>(null);
  const [deleteBill, setDeleteBill] = useState<any | null>(null);

  const totalDraftQty = useMemo(() => {
    if (!draft) return 0;
    return draft.items.reduce((sum, it) => sum + (Number(it.qty) || 0), 0);
  }, [draft]);

  const initializeManual = () => {
    setDraft({
      vendor: "",
      bill_no: "",
      bill_date: new Date().toISOString().split("T")[0],
      items: [{ raw_name: "", qty: 0, rate: 0 }],
    });
    setMatches([null]);
    setFile(null);
  };

  function autoMatch(raw: string): string | null {
    if (!items.data) return null;
    const r = raw.toLowerCase();
    let best: { id: string; score: number } | null = null;
    for (const it of items.data) {
      const n = it.name.toLowerCase();
      let score = 0;
      const tokens = n.split(/[\s/x*-]+/).filter(Boolean);
      for (const t of tokens) if (t.length > 1 && r.includes(t)) score += t.length;
      if (score > (best?.score ?? 0)) best = { id: it.id, score };
    }
    return best && best.score >= 3 ? best.id : null;
  }

  async function onExtract() {
    if (!file) return;
    setBusy(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      const sectionMap = new Map((sections.data ?? []).map((s: any) => [s.id, s.name]));
      const catalog = (items.data ?? []).map((it: any) => ({
        id: it.id,
        name: it.name,
        section: it.section_id ? sectionMap.get(it.section_id) ?? null : null,
      }));
      const result = await extract({ data: { dataUrl, type, catalog } });
      setDraft(result);
      setMatches(result.items.map((i) => i.matched_item_id ?? autoMatch(i.raw_name)));
      toast.success(`Extracted ${result.items.length} items`);
    } catch (e: any) {
      toast.error(e.message ?? "Extract failed");
    } finally {
      setBusy(false);
    }
  }

  const save = useMutation({
    mutationFn: async () => {
      if (!draft) throw new Error("nothing to save");
      let path: string | null = null;
      if (!skipUpload && file) {
        path = `${Date.now()}_${file.name}`;
        const up = await supabase.storage.from("bills").upload(path, file);
        if (up.error) throw up.error;
      }

      const { data: bill, error: be } = await supabase
        .from("bills")
        .insert({ type, vendor: draft.vendor, bill_no: draft.bill_no, bill_date: draft.bill_date, file_path: path })
        .select().single();
      if (be) throw be;

      const rows = draft.items.map((it, i) => ({
        bill_id: bill.id,
        item_id: matches[i],
        raw_name: it.raw_name,
        qty: Number(it.qty) || 0,
        rate: Number(it.rate) || 0,
      }));
      if (rows.length) {
        const { error } = await supabase.from("bill_items").insert(rows);
        if (error) throw error;
      }

      for (let i = 0; i < draft.items.length; i++) {
        const id = matches[i];
        if (!id) continue;
        const { data: it } = await supabase.from("items").select("available_qty").eq("id", id).single();
        const qty = Number(draft.items[i].qty) || 0;
        const rate = Number(draft.items[i].rate) || 0;
        const newQty = Number(it?.available_qty || 0) + (type === "purchase" ? qty : -qty);
        await supabase.from("items").update({
          available_qty: newQty,
          ...(type === "purchase" && rate > 0 ? { last_purchase_rate: rate } : {}),
        }).eq("id", id);
      }

      if (linkSaudaId && linkSaudaId !== "none") {
        const sauda = (saudas.data as any[])?.find((s) => s.id === linkSaudaId);
        const billQty = rows.reduce((a, r) => a + Number(r.qty || 0), 0);
        await supabase.from("saudas").update({ linked_bill_id: bill.id }).eq("id", linkSaudaId);
        if (billQty > 0) {
          await supabase.from("sauda_uplifts").insert({ sauda_id: linkSaudaId, qty: billQty, kind: "bill", bill_id: bill.id, note: `Bill ${draft.bill_no ?? bill.id.slice(0, 6)}` });
          const totalQty = Number(sauda?.total_qty || 0) || (sauda?.sauda_items ?? []).reduce((a: number, r: any) => a + Number(r.qty || 0), 0);
          const newLifted = Number(sauda?.lifted_qty ?? 0) + billQty;
          const cappedLifted = totalQty > 0 ? Math.min(totalQty, newLifted) : newLifted;
          await supabase.from("saudas").update({ lifted_qty: cappedLifted, status: (totalQty > 0 && cappedLifted >= totalQty) ? "done" : "open" }).eq("id", linkSaudaId);
        }
      }
    },
    onSuccess: () => {
      toast.success("Bill saved and Stock updated");
      setDraft(null); setFile(null); setMatches([]); setLinkSaudaId("none");
      qc.invalidateQueries({ queryKey: ["bills"] });
      qc.invalidateQueries({ queryKey: ["items"] });
      qc.invalidateQueries({ queryKey: ["saudas"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>Upload or Create Bill</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-3 items-end">
             <div className="space-y-1">
              <Label>Type</Label>
              <Select value={type} onValueChange={(v: any) => setType(v)}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="purchase">Purchase</SelectItem>
                  <SelectItem value="sale">Sale</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 flex-1 min-w-[200px]">
              <Label>File (PDF / image)</Label>
              <Input type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </div>
            <Button onClick={onExtract} disabled={!file || busy}>
              {busy ? <Loader2 className="animate-spin mr-2" /> : null}
              {busy ? "Extracting…" : "Extract with AI"}
            </Button>
            <Button variant="outline" onClick={initializeManual}><Plus className="mr-2 h-4 w-4" /> Manual Entry</Button>
          </div>
          {draft && (
            <div className="space-y-3 pt-3 border-t">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div><Label>Vendor</Label><Input value={draft.vendor ?? ""} onChange={(e) => setDraft({ ...draft, vendor: e.target.value })} /></div>
                <div><Label>Bill No</Label><Input value={draft.bill_no ?? ""} onChange={(e) => setDraft({ ...draft, bill_no: e.target.value })} /></div>
                <div><Label>Bill Date</Label><Input type="date" value={draft.bill_date ?? ""} onChange={(e) => setDraft({ ...draft, bill_date: e.target.value })} /></div>
              </div>
              <div className="overflow-x-auto border rounded-md max-h-[400px] overflow-y-auto">
                <table className="w-full text-sm min-w-[600px]">
                  <thead className="bg-muted/50 border-b text-left sticky top-0 z-10">
                    <tr>
                      <th className="p-2">Item Name</th>
                      <th className="p-2">Match Matrix Item</th>
                      <th className="p-2 w-28">Qty (MT)</th>
                      <th className="p-2 w-32">Rate</th>
                      <th className="p-2 w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {draft.items.map((it, i) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="p-2">
                           <Input 
                             value={it.raw_name} 
                             onChange={(e) => {
                               const d = { ...draft }; d.items[i].raw_name = e.target.value; setDraft(d);
                             }} 
                             className="h-10 text-base sm:text-sm"
                           />
                        </td>
                        <td className="p-2">
                          <ItemPicker
                            items={items.data ?? []}
                            sections={sections.data ?? []}
                            value={matches[i]}
                            onChange={(id) => { const n = [...matches]; n[i] = id; setMatches(n); }}
                            width="w-full"
                          />
                        </td>
                        <td className="p-2">
                          <Input 
                            type="number" 
                            step="0.001"
                            value={it.qty} 
                            onChange={(e) => {
                              const d = { ...draft }; d.items[i].qty = Number(e.target.value); setDraft(d);
                            }} 
                            className="font-mono h-10 text-base sm:text-sm"
                          />
                        </td>
                        <td className="p-2">
                          <Input 
                            type="number" 
                            value={it.rate} 
                            onChange={(e) => {
                              const d = { ...draft }; d.items[i].rate = Number(e.target.value); setDraft(d);
                            }} 
                            className="font-mono h-10 text-base sm:text-sm"
                          />
                        </td>
                        <td>
                          <Button variant="ghost" size="icon" onClick={() => {
                             const d = { ...draft }; d.items.splice(i, 1); setDraft(d);
                             const m = [...matches]; m.splice(i, 1); setMatches(m);
                          }}>×</Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-muted/30 font-bold border-t">
                    <tr>
                      <td colSpan={2} className="p-3 text-right uppercase tracking-wider text-xs">Total Quantity</td>
                      <td className="p-3 font-mono text-base text-primary">{totalDraftQty.toFixed(3)}</td>
                      <td colSpan={2}></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <Button variant="outline" size="sm" onClick={() => {
                setDraft({...draft, items: [...draft.items, { raw_name: "", qty: 0, rate: 0 }]});
                setMatches([...matches, null]);
              }}>+ Add Item</Button>
               <div className="space-y-1">
                <Label>Link to Sauda (optional)</Label>
                <Select value={linkSaudaId} onValueChange={setLinkSaudaId}>
                  <SelectTrigger className="w-full max-w-md"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— none —</SelectItem>
                    {saudas.data?.filter((s: any) => s.status !== "done").map((s: any) => {
                      const totalQty = Number(s.total_qty || 0) || (s.sauda_items ?? []).reduce((a: number, r: any) => a + Number(r.qty || 0), 0);
                      const pending = Math.max(0, totalQty - Number(s.lifted_qty || 0));
                      return (
                        <SelectItem key={s.id} value={s.id}>
                          {s.party_name} — {s.sauda_date} — pending {pending}T
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-2">
                <Button onClick={() => save.mutate()} disabled={save.isPending}>
                  {save.isPending ? <Loader2 className="animate-spin mr-2" /> : null}
                  Save Bill & Update Inventory
                </Button>
                <Button variant="outline" onClick={() => { setDraft(null); setMatches([]); setLinkSaudaId("none"); }}>Cancel</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader><CardTitle>Recent Transaction Bills</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b text-left bg-muted/30">
              <tr>
                <th className="p-3">Date</th>
                <th className="p-3">Type</th>
                <th className="p-3">Vendor / Party</th>
                <th className="p-3">Bill #</th>
                <th className="p-3">Items</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {bills.data?.map((b: any) => (
                <tr key={b.id} className="border-b hover:bg-muted/40 transition-colors">
                  <td className="p-3">{b.bill_date ?? new Date(b.created_at).toLocaleDateString()}</td>
                  <td className="p-3">
                    <Badge variant={b.type === "purchase" ? "default" : "secondary"} className="uppercase text-[10px]">{b.type}</Badge>
                  </td>
                  <td className="p-3 font-medium">{b.vendor ?? "—"}</td>
                  <td className="p-3 font-mono">{b.bill_no ?? "—"}</td>
                  <td className="p-3 text-muted-foreground">{b.bill_items?.length ?? 0} rows</td>
                  <td className="p-3 text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setEditBill(b)}><Pencil className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:bg-destructive/10" onClick={() => setDeleteBill(b)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
              {!bills.data?.length && (
                <tr><td colSpan={6} className="p-12 text-center text-muted-foreground italic">No transaction history recorded yet.</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {editBill && (
        <EditBillDialog
          bill={editBill}
          items={items.data ?? []}
          sections={sections.data ?? []}
          open={!!editBill}
          onClose={() => setEditBill(null)}
        />
      )}

      {deleteBill && (
        <DeleteBillDialog
          bill={deleteBill}
          open={!!deleteBill}
          onClose={() => setDeleteBill(null)}
        />
      )}
    </div>
  );
}
