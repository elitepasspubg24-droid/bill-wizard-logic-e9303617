import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fetchFactories, fetchSections, fetchItems, fetchSaudas } from "@/lib/queries";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { List, Sliders, FileText, FileDown, Plus, Edit, ShoppingCart, Trash2, ReceiptText, Share2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetFooter,
} from "@/components/ui/sheet";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

type ColKey = "gauge_diff" | "today" | "sauda" | "party" | "available_qty" | "last_purchase_rate";
const ALL_COLS: { key: ColKey; label: string }[] = [
  { key: "gauge_diff", label: "Gauge Diff" },
  { key: "today", label: "Today Rate" },
  { key: "sauda", label: "Sauda Rate" },
  { key: "party", label: "Party Rate" },
  { key: "available_qty", label: "Stock Qty" },
  { key: "last_purchase_rate", label: "Last Purchase" },
];
const DEFAULT_PDF_COLS: ColKey[] = ["available_qty", "last_purchase_rate"];

// --- UPDATED CART TYPE ---
type CartItem = {
  id: string;
  name: string;
  rate: number;
  qty: string; 
  sectionName: string;
};

export const Route = createFileRoute("/_app/items")({
  component: ItemsPage,
  head: () => ({ meta: [{ title: "Items Summary" }] }),
});

function ItemsPage() {
  const factories = useQuery({ queryKey: ["factories"], queryFn: fetchFactories });
  const sections = useQuery({ queryKey: ["sections"], queryFn: fetchSections });
  const items = useQuery({ queryKey: ["items"], queryFn: fetchItems });
  const saudas = useQuery({ queryKey: ["saudas"], queryFn: fetchSaudas });
  const queryClient = useQueryClient();
  
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState("");
  const [pickedTodayFactory, setPickedTodayFactory] = useState<Record<string, string>>({});
  const [pickedSauda, setPickedSauda] = useState<Record<string, string>>({});
  const [isEditingGauges, setIsEditingGauges] = useState(false);
  const [localGauges, setLocalGauges] = useState<Record<string, number>>({});
  const [pdfCols, setPdfCols] = useState<ColKey[]>(DEFAULT_PDF_COLS);

  // --- CART STATE ---
  const [cart, setCart] = useState<CartItem[]>([]);
  const [partyName, setPartyName] = useState("");

  // --- CRUD Modal UI States ---
  const [isSectionDialogOpen, setIsSectionDialogOpen] = useState(false);
  const [isItemDialogOpen, setIsItemDialogOpen] = useState(false);
  
  const [sectionForm, setSectionForm] = useState({ id: "", name: "", factory_id: "" });
  const [itemForm, setItemForm] = useState({
    id: "",
    name: "",
    section_id: "",
    gauge_diff: 0,
    available_qty: 0,
    last_purchase_rate: "",
  });

  const allOpenSaudas = useMemo(() => {
    if (!saudas.data) return [];
    return (saudas.data as any[]).filter(s => s.factory_id && s.status !== "done").map(s => ({
      id: s.id,
      basic: Number(s.sauda_basic),
      party: s.party_name,
      factory_id: s.factory_id,
      pending: Math.max(0, (Number(s.total_qty || 0) || (s.sauda_items ?? []).reduce((a: number, r: any) => a + Number(r.qty || 0), 0)) - Number(s.lifted_qty || 0))
    }));
  }, [saudas.data]);

  const grouped = useMemo(() => {
    if (!sections.data || !items.data || !factories.data) return [];
    const fmap = new Map(factories.data.map((f: any) => [f.id, f]));

    return sections.data.map((s: any) => {
      const activeTodayFactoryId = pickedTodayFactory[s.id] ?? s.factory_id;
      const activeTodayFactory: any = fmap.get(activeTodayFactoryId);
      const activeFacBasic = Number(activeTodayFactory?.basic_rate ?? 0);
      const activeFacAdder = Number(activeTodayFactory?.adder ?? 0);
      const activePartyAdder = Number(activeTodayFactory?.party_adder ?? 0);

      const baseToday = activeFacBasic + activeFacAdder;
      const baseParty = baseToday + activePartyAdder;

      const topSauda = allOpenSaudas.find(
        (so) => so.id === pickedSauda[s.id] || so.factory_id === activeTodayFactoryId
      );
      const saudaFactory: any = topSauda ? fmap.get(topSauda.factory_id) : null;
      const saudaFacAdder = Number(saudaFactory?.adder ?? 0);
      const baseSauda = topSauda ? topSauda.basic + saudaFacAdder : null;

      const rows = items.data!
        .filter((i: any) => i.section_id === s.id)
        .filter((i: any) => !q || i.name.toLowerCase().includes(q.toLowerCase()))
        .map((i: any) => {
          const gaugeDiff =
            localGauges[i.id] !== undefined ? localGauges[i.id] : Number(i.gauge_diff ?? 0);
          return {
            ...i,
            gauge_diff: gaugeDiff,
            today: baseToday + gaugeDiff,
            sauda: baseSauda !== null ? baseSauda + gaugeDiff : null,
            party: baseParty + gaugeDiff,
          };
        });

      return {
        section: s,
        activeTodayFactory,
        rows,
      };
    })
    .filter((g: any) => g.rows.length > 0)
    .sort((a: any, b: any) => {
      if (a.section.name.trim().toLowerCase().includes("ms pipe")) return 1;
      if (b.section.name.trim().toLowerCase().includes("ms pipe")) return -1;
      return 0;
    });
  }, [factories.data, sections.data, items.data, pickedTodayFactory, pickedSauda, allOpenSaudas, q, localGauges]);

  // --- CART HELPERS ---
  const toggleCart = (item: any, sectionName: string) => {
    setCart((prev) => {
      const isSelected = prev.find((i) => i.id === item.id);
      if (isSelected) {
        return prev.filter((i) => i.id !== item.id);
      }
      return [...prev, { id: item.id, name: item.name, rate: item.party, qty: "", sectionName }];
    });
  };

  const updateCartItem = (id: string, field: 'rate' | 'qty', value: any) => {
    setCart((prev) => prev.map((i) => (i.id === id ? { ...i, [field]: value } : i)));
  };

  // 1. STANDARD FULL PDF EXPORT
  const handleExportCartPDF = () => {
    if (cart.length === 0) return;
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    doc.setFontSize(20);
    doc.text("Quotation", 40, 50);
    doc.setFontSize(12);
    if (partyName) {
      doc.setFont("helvetica", "bold");
      doc.text(`Party: ${partyName.toUpperCase()}`, 40, 75);
    }
    doc.setFont("helvetica", "normal");
    doc.text(`Date: ${new Date().toLocaleDateString()}`, 40, 90);

    const body = cart.map((i, index) => [index + 1, i.name, i.qty || "-", i.rate.toFixed(0)]);
    autoTable(doc, {
      startY: 110,
      head: [["#", "Item Description", "Quantity", "Rate (Rs)"]],
      body: body,
      theme: "grid",
      headStyles: { fillColor: [40, 40, 40], textColor: 255 },
      columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right', fontStyle: 'bold' } }
    });
    doc.save(`${partyName || 'Quote'}.pdf`);
  };

  // 2. CONCISE "IMAGE-LIKE" PDF EXPORT
  // Uses a custom narrow width for perfect mobile viewing/screenshotting
  const handleExportConcise = () => {
    if (cart.length === 0) return;
    const doc = new jsPDF({ unit: "pt", format: [300, 600] }); // Narrow & Tall for Mobile
    
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text(partyName ? partyName.toUpperCase() : "RATE LIST", 150, 25, { align: 'center' });
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.text(new Date().toLocaleDateString(), 150, 38, { align: 'center' });

    const body = cart.map(i => [i.name, i.qty || "-", i.rate.toFixed(0)]);
    autoTable(doc, {
      startY: 50,
      margin: { left: 10, right: 10 },
      head: [["Item", "Qty", "Rate"]],
      body: body,
      theme: "grid",
      styles: { fontSize: 9, cellPadding: 4 },
      headStyles: { fillColor: [0, 0, 0] },
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right', fontStyle: 'bold' } }
    });
    doc.save(`${partyName || 'Rates'}_Short.pdf`);
  };

  const openAddSection = () => {
    setSectionForm({ id: "", name: "", factory_id: factories.data?.[0]?.id || "" });
    setIsSectionDialogOpen(true);
  };
  const openEditSection = (section: any) => {
    setSectionForm({ id: section.id, name: section.name, factory_id: section.factory_id || "" });
    setIsSectionDialogOpen(true);
  };
  const openAddItem = (sectionId?: string) => {
    setItemForm({ id: "", name: "", section_id: sectionId || sections.data?.[0]?.id || "", gauge_diff: 0, available_qty: 0, last_purchase_rate: "" });
    setIsItemDialogOpen(true);
  };
  const openEditItem = (item: any) => {
    setItemForm({ id: item.id, name: item.name, section_id: item.section_id, gauge_diff: item.gauge_diff, available_qty: Number(item.available_qty || 0), last_purchase_rate: item.last_purchase_rate != null ? String(item.last_purchase_rate) : "" });
    setIsItemDialogOpen(true);
  };

  const handleSaveSection = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const { error } = sectionForm.id 
        ? await supabase.from("sections").update({ name: sectionForm.name.trim(), factory_id: sectionForm.factory_id }).eq("id", sectionForm.id)
        : await supabase.from("sections").insert({ name: sectionForm.name.trim(), factory_id: sectionForm.factory_id, position: sections.data?.length || 0 });
      if (error) throw error;
      toast.success("Saved");
      await queryClient.invalidateQueries({ queryKey: ["sections"] });
      setIsSectionDialogOpen(false);
    } catch (err: any) { toast.error(err.message); } finally { setSaving(false); }
  };

  const handleSaveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { name: itemForm.name.trim(), section_id: itemForm.section_id, gauge_diff: Number(itemForm.gauge_diff), available_qty: Number(itemForm.available_qty), last_purchase_rate: itemForm.last_purchase_rate === "" ? null : Number(itemForm.last_purchase_rate) };
      const { error } = itemForm.id 
        ? await supabase.from("items").update(payload).eq("id", itemForm.id)
        : await supabase.from("items").insert({ ...payload, position: 0 });
      if (error) throw error;
      toast.success("Saved");
      await queryClient.invalidateQueries({ queryKey: ["items"] });
      setIsItemDialogOpen(false);
    } catch (err: any) { toast.error(err.message); } finally { setSaving(false); }
  };

  return (
    <div className="w-full space-y-4 pb-20">
      <div className="flex items-center justify-between border-b pb-3 gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-bold">Items Matrix</h2>
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline" size="sm" className="relative h-9 gap-2">
                <ShoppingCart className="h-4 w-4" /> Cart
                {cart.length > 0 && (
                  <span className="absolute -top-1 -right-1 bg-primary text-primary-foreground text-[10px] rounded-full h-4 w-4 flex items-center justify-center font-bold">
                    {cart.length}
                  </span>
                )}
              </Button>
            </SheetTrigger>
            <SheetContent className="w-full sm:max-w-xl overflow-y-auto flex flex-col">
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2"><ReceiptText className="h-5 w-5" /> Cart & Quote</SheetTitle>
                <SheetDescription>Configure items and rates for party export.</SheetDescription>
              </SheetHeader>
              <div className="py-6 space-y-6 flex-1">
                <div className="space-y-2">
                  <Label>Party Name (Optional)</Label>
                  <Input placeholder="Enter Customer Name..." value={partyName} onChange={(e) => setPartyName(e.target.value)} />
                </div>
                <div className="space-y-3">
                  <div className="grid grid-cols-12 gap-2 px-2 text-[10px] font-bold uppercase text-muted-foreground">
                    <div className="col-span-6">Item</div>
                    <div className="col-span-3 text-right">Qty</div>
                    <div className="col-span-3 text-right">Rate</div>
                  </div>
                  {cart.length === 0 ? <div className="text-center py-10 text-muted-foreground text-sm border rounded-lg border-dashed">Cart is Empty</div> : (
                    <div className="space-y-2">
                      {cart.map((item) => (
                        <div key={item.id} className="grid grid-cols-12 items-center gap-2 p-2 border rounded-md bg-muted/20">
                          <div className="col-span-6"><p className="text-xs font-semibold truncate leading-none">{item.name}</p></div>
                          <div className="col-span-3"><Input value={item.qty} onChange={(e) => updateCartItem(item.id, 'qty', e.target.value)} className="h-8 text-right text-xs" placeholder="—" /></div>
                          <div className="col-span-2"><Input type="number" value={item.rate} onChange={(e) => updateCartItem(item.id, 'rate', Number(e.target.value))} className="h-8 text-right text-xs font-bold" /></div>
                          <div className="col-span-1 text-right"><Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => toggleCart(item, "")}><Trash2 className="h-3.5 w-3.5" /></Button></div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <SheetFooter className="flex-col gap-2 sm:flex-col mt-auto border-t pt-6">
                <div className="grid grid-cols-2 gap-2 w-full">
                  <Button disabled={cart.length === 0} onClick={handleExportCartPDF} className="gap-2"><FileDown className="h-4 w-4" /> Full PDF</Button>
                  <Button disabled={cart.length === 0} onClick={handleExportConcise} variant="secondary" className="gap-2"><Share2 className="h-4 w-4" /> Concise PDF</Button>
                </div>
                <Button variant="outline" className="w-full text-xs" onClick={() => setCart([])} disabled={cart.length === 0}>Clear All</Button>
              </SheetFooter>
            </SheetContent>
          </Sheet>
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <Input placeholder="Search..." value={q} onChange={(e) => setQ(e.target.value)} className="w-32 md:w-48 h-9" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button size="sm" className="h-9 gap-1.5"><Plus className="h-4 w-4" /> Add</Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => openAddItem()}>New Item</DropdownMenuItem>
              <DropdownMenuItem onClick={openAddSection}>New Section</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {grouped.map(({ section, rows }) => (
          <Card key={section.id} className="overflow-hidden">
            <div className="p-3 bg-muted/40 border-b flex justify-between items-center">
              <h3 className="font-bold text-sm">{section.name}</h3>
              <Select value={pickedTodayFactory[section.id] ?? section.factory_id} onValueChange={(v) => setPickedTodayFactory(p => ({ ...p, [section.id]: v }))}>
                <SelectTrigger className="h-7 w-32 text-[10px] bg-background"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {factories.data?.map((f: any) => <SelectItem key={f.id} value={f.id} className="text-xs">{f.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="divide-y">
              {rows.map((r: any) => {
                const isInCart = cart.some(ci => ci.id === r.id);
                return (
                  <div key={r.id} className={`flex px-4 py-3 items-center hover:bg-muted/10 transition-colors ${isInCart ? "bg-primary/5" : ""}`}>
                    <div className="flex-1 flex items-center gap-3">
                      <button onClick={() => toggleCart(r, section.name)} className={`p-2 rounded-full transition-colors ${isInCart ? "text-primary bg-primary/10 shadow-sm" : "text-muted-foreground hover:bg-muted"}`}>
                        <ShoppingCart className="h-4 w-4" />
                      </button>
                      <span className="font-medium text-sm">{r.name}</span>
                    </div>
                    <div className="flex items-center gap-6">
                      <div className="text-right">
                        <p className="text-[9px] text-muted-foreground uppercase font-bold">Party Rate</p>
                        <p className="font-mono font-bold text-primary">₹{r.party.toFixed(0)}</p>
                      </div>
                      <Button onClick={() => openEditItem(r)} variant="ghost" size="icon" className="h-8 w-8"><Edit className="h-3.5 w-3.5" /></Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        ))}
      </div>

      {/* DIALOGS FOR CRUD (Sections/Items) */}
      <Dialog open={isSectionDialogOpen} onOpenChange={setIsSectionDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Section Group</DialogTitle></DialogHeader>
          <form onSubmit={handleSaveSection} className="space-y-4 pt-2">
            <div className="space-y-1"><Label>Name</Label><Input value={sectionForm.name} onChange={(e) => setSectionForm(p => ({ ...p, name: e.target.value }))} required /></div>
            <div className="space-y-1"><Label>Factory</Label><Select value={sectionForm.factory_id} onValueChange={(v) => setSectionForm(p => ({ ...p, factory_id: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{factories.data?.map((f: any) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}</SelectContent>
            </Select></div>
            <DialogFooter><Button type="submit" disabled={saving}>{saving ? "Saving..." : "Save"}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={isItemDialogOpen} onOpenChange={setIsItemDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Item Details</DialogTitle></DialogHeader>
          <form onSubmit={handleSaveItem} className="space-y-4 pt-2">
            <div className="space-y-1"><Label>Item Name</Label><Input value={itemForm.name} onChange={(e) => setItemForm(p => ({ ...p, name: e.target.value }))} required /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label>Gauge Diff</Label><Input type="number" value={itemForm.gauge_diff} onChange={(e) => setItemForm(p => ({ ...p, gauge_diff: Number(e.target.value) }))} /></div>
              <div className="space-y-1"><Label>Stock (MT)</Label><Input type="number" value={itemForm.available_qty} onChange={(e) => setItemForm(p => ({ ...p, available_qty: Number(e.target.value) }))} /></div>
            </div>
            <DialogFooter><Button type="submit" disabled={saving}>{saving ? "Saving..." : "Save Item"}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
