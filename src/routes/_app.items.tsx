import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, useRef } from "react";
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
import { List, Sliders, FileText, FileDown, Plus, Edit, ShoppingCart, Trash2, Download, ReceiptText, Image as ImageIcon } from "lucide-react";
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
import html2canvas from "html2canvas";

// --- Types ---
type ColKey = "gauge_diff" | "today" | "sauda" | "party" | "available_qty" | "last_purchase_rate";

type CartItem = {
  id: string;
  name: string;
  rate: number;
  sectionName: string;
  qty?: string;
};

const ALL_COLS: { key: ColKey; label: string }[] = [
  { key: "gauge_diff", label: "Gauge Diff" },
  { key: "today", label: "Today Rate" },
  { key: "sauda", label: "Sauda Rate" },
  { key: "party", label: "Party Rate" },
  { key: "available_qty", label: "Stock Qty" },
  { key: "last_purchase_rate", label: "Last Purchase" },
];
const DEFAULT_PDF_COLS: ColKey[] = ["available_qty", "last_purchase_rate"];

export const Route = createFileRoute("/_app/items")({
  component: ItemsPage,
  head: () => ({ meta: [{ title: "Items Matrix" }] }),
});

function ItemsPage() {
  const queryClient = useQueryClient();
  const factories = useQuery({ queryKey: ["factories"], queryFn: fetchFactories });
  const sections = useQuery({ queryKey: ["sections"], queryFn: fetchSections });
  const items = useQuery({ queryKey: ["items"], queryFn: fetchItems });
  const saudas = useQuery({ queryKey: ["saudas"], queryFn: fetchSaudas });
  
  // Local UI States
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState("");
  const [pickedTodayFactory, setPickedTodayFactory] = useState<Record<string, string>>({});
  const [pickedSauda, setPickedSauda] = useState<Record<string, string>>({});
  const [isEditingGauges, setIsEditingGauges] = useState(false);
  const [localGauges, setLocalGauges] = useState<Record<string, number>>({});
  const [pdfCols, setPdfCols] = useState<ColKey[]>(DEFAULT_PDF_COLS);

  // Cart & Export Ref
  const [cart, setCart] = useState<CartItem[]>([]);
  const [partyName, setPartyName] = useState("");
  const cartRef = useRef<HTMLDivElement>(null);

  // Modal Management
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

  // --- Calculations ---
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

    return (sections.data as any[]).map((s: any) => {
      const activeTodayFactoryId = pickedTodayFactory[s.id] ?? s.factory_id;
      const activeTodayFactory: any = fmap.get(activeTodayFactoryId);
      const activeFacBasic = Number(activeTodayFactory?.basic_rate ?? 0);
      const activeFacAdder = Number(activeTodayFactory?.adder ?? 0);
      const activePartyAdder = Number(activeTodayFactory?.party_adder ?? 0);

      const baseToday = activeFacBasic + activeFacAdder;
      const baseParty = baseToday + activePartyAdder;

      const topSauda = allOpenSaudas.find(
        (so) => so.id === pickedSauda[s.id] || (so.factory_id === activeTodayFactoryId && !pickedSauda[s.id])
      );
      const saudaFactory: any = topSauda ? fmap.get(topSauda.factory_id) : null;
      const saudaFacAdder = Number(saudaFactory?.adder ?? 0);
      const baseSauda = topSauda ? topSauda.basic + saudaFacAdder : null;

      const rows = items.data!
        .filter((i: any) => i.section_id === s.id)
        .filter((i: any) => !q || i.name.toLowerCase().includes(q.toLowerCase()))
        .map((i: any) => {
          const gaugeDiff = localGauges[i.id] !== undefined ? localGauges[i.id] : Number(i.gauge_diff ?? 0);
          return {
            ...i,
            gauge_diff: gaugeDiff,
            today: baseToday + gaugeDiff,
            sauda: baseSauda !== null ? baseSauda + gaugeDiff : null,
            party: baseParty + gaugeDiff,
          };
        });

      return { section: s, activeTodayFactory, activeFacBasic, activeFacAdder, activePartyAdder, topSauda, saudaFactory, saudaFacAdder, rows };
    })
    .filter((g: any) => g.rows.length > 0)
    .sort((a, b) => {
      const aPipe = a.section.name.trim().toLowerCase().includes("pipe");
      const bPipe = b.section.name.trim().toLowerCase().includes("pipe");
      if (aPipe && !bPipe) return 1;
      if (!aPipe && bPipe) return -1;
      return 0;
    });
  }, [factories.data, sections.data, items.data, pickedTodayFactory, pickedSauda, allOpenSaudas, q, localGauges]);

  // --- Cart Helpers ---
  const toggleCart = (item: any, sectionName: string) => {
    setCart((prev) => {
      const isSelected = prev.find((i) => i.id === item.id);
      if (isSelected) return prev.filter((i) => i.id !== item.id);
      return [...prev, { id: item.id, name: item.name, rate: item.party, sectionName, qty: "" }];
    });
  };

  const updateCartRate = (id: string, rate: number) => {
    setCart((prev) => prev.map((i) => (i.id === id ? { ...i, rate } : i)));
  };

  const updateCartQty = (id: string, qty: string) => {
    setCart((prev) => prev.map((i) => (i.id === id ? { ...i, qty } : i)));
  };

  // --- Export Functions ---
  const handleExportCartPDF = () => {
    if (cart.length === 0) return;
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    doc.setFontSize(20);
    doc.text("Quotation", 40, 50);
    doc.setFontSize(12);
    if (partyName) doc.text(`To: ${partyName}`, 40, 75);
    doc.text(`Date: ${new Date().toLocaleDateString()}`, 40, partyName ? 95 : 75);

    const body = cart.map((i) => [i.name, i.qty || "—", `Rs. ${Number(i.rate).toFixed(0)}`]);
    autoTable(doc, {
      startY: partyName ? 115 : 95,
      head: [["Item Name / Size", "Quantity", "Rate"]],
      body: body,
      theme: "grid",
      headStyles: { fillColor: [40, 40, 40] },
      columnStyles: { 1: { halign: "center" }, 2: { halign: "right" } }
    });
    doc.save(`Quotation_${partyName || "Export"}.pdf`);
  };

  const handleExportCartImage = async () => {
    if (!cartRef.current || cart.length === 0) return;
    try {
      const canvas = await html2canvas(cartRef.current, {
        backgroundColor: "#ffffff",
        scale: 2,
        logging: false,
        useCORS: true
      });
      const link = document.createElement("a");
      link.download = `Quote_${partyName || "Export"}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    } catch (err) {
      toast.error("Image generation failed.");
    }
  };

  const handleExportCSV = () => {
    let csvContent = "data:text/csv;charset=utf-8,";
    grouped.forEach(({ section, rows }) => {
      csvContent += `SECTION: ${section.name.toUpperCase()}\r\n`;
      csvContent += "Item,Gauge Diff,Today Rate,Sauda Rate,Party Rate,Stock Qty\r\n";
      rows.forEach((r) => {
        csvContent += `"${r.name}",${r.gauge_diff},${r.today},${r.sauda ?? "—"},${r.party},${Number(r.available_qty).toFixed(2)}\r\n`;
      });
      csvContent += "\r\n";
    });
    const link = document.createElement("a");
    link.setAttribute("href", encodeURI(csvContent));
    link.setAttribute("download", "Rates_Full_Report.csv");
    link.click();
  };

  const handleExportMainPDF = () => {
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const selectedCols = ALL_COLS.filter((c) => pdfCols.includes(c.key));
    const head = [["Item", ...selectedCols.map((c) => c.label)]];

    doc.setFontSize(16).setFont("helvetica", "bold");
    doc.text("Items Inventory Report", pageWidth / 2, 40, { align: "center" });
    doc.setFontSize(9).setFont("helvetica", "normal").setTextColor(120);
    doc.text(new Date().toLocaleString(), pageWidth / 2, 55, { align: "center" });

    let cursorY = 80;
    grouped.forEach(({ section, rows }) => {
      doc.setFontSize(12).setFont("helvetica", "bold").setTextColor(0);
      doc.text(section.name, 40, cursorY);
      cursorY += 15;
      const body = rows.map((r) => [
        r.name, 
        ...selectedCols.map((c) => {
           if (c.key === "gauge_diff") return r.gauge_diff > 0 ? `+${r.gauge_diff}` : r.gauge_diff;
           if (c.key === "available_qty") return `${Number(r.available_qty).toFixed(1)} MT`;
           return r[c.key] != null ? String(r[c.key]) : "—";
        })
      ]);
      autoTable(doc, {
        head, body, startY: cursorY, margin: { left: 40, right: 40 },
        styles: { fontSize: 9 }, headStyles: { fillColor: [240, 240, 240], textColor: 0 },
        theme: "grid"
      });
      cursorY = (doc as any).lastAutoTable.finalY + 25;
    });
    doc.save("Full_Inventory_Report.pdf");
  };

  // --- CRUD DB Operations ---
  const handleSaveSection = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { name: sectionForm.name.trim(), factory_id: sectionForm.factory_id };
      if (sectionForm.id) {
        await supabase.from("sections").update(payload).eq("id", sectionForm.id);
      } else {
        await supabase.from("sections").insert({ ...payload, position: sections.data?.length ?? 0 });
      }
      toast.success("Section updated");
      queryClient.invalidateQueries({ queryKey: ["sections"] });
      setIsSectionDialogOpen(false);
    } catch (err) { toast.error("Failed to save section"); }
    finally { setSaving(false); }
  };

  const handleSaveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        name: itemForm.name.trim(),
        section_id: itemForm.section_id,
        gauge_diff: Number(itemForm.gauge_diff),
        available_qty: Number(itemForm.available_qty),
        last_purchase_rate: itemForm.last_purchase_rate ? Number(itemForm.last_purchase_rate) : null,
      };
      if (itemForm.id) {
        await supabase.from("items").update(payload).eq("id", itemForm.id);
      } else {
        const nextPos = (items.data?.filter((i: any) => i.section_id === itemForm.section_id).length ?? 0);
        await supabase.from("items").insert({ ...payload, position: nextPos });
      }
      toast.success("Item updated");
      queryClient.invalidateQueries({ queryKey: ["items"] });
      setIsItemDialogOpen(false);
    } catch (err) { toast.error("Failed to save item"); }
    finally { setSaving(false); }
  };

  return (
    <div className="w-full space-y-4 pb-20 relative">
      
      {/* 🖼️ HIDDEN CAPTURE AREA FOR IMAGE EXPORT (Always rendered for html2canvas) */}
      <div className="fixed -left-[3000px] top-0 pointer-events-none">
        <div ref={cartRef} className="p-12 w-[650px] bg-white text-slate-950 font-sans shadow-none">
          <div className="flex justify-between items-end mb-8 border-b-4 border-slate-900 pb-5">
            <div>
              <h1 className="text-4xl font-black uppercase tracking-tighter">Quotation</h1>
              <p className="text-md font-bold text-slate-500 mt-2 uppercase">{partyName || "Estimate Only"}</p>
            </div>
            <div className="text-right">
              <p className="text-md font-black">{new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
            </div>
          </div>
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b-2 border-slate-900 text-xs font-black uppercase text-slate-500 tracking-widest">
                <th className="py-3 pr-4">Item Description</th>
                <th className="py-3 text-center w-24">Qty</th>
                <th className="py-3 text-right w-32">Rate (₹)</th>
              </tr>
            </thead>
            <tbody>
              {cart.map(item => (
                <tr key={item.id} className="border-b border-slate-100">
                  <td className="py-5 font-bold text-slate-900 text-md">{item.name}</td>
                  <td className="py-5 text-center text-slate-600 font-bold text-sm">{item.qty || "—"}</td>
                  <td className="py-5 text-right font-mono font-black text-slate-950 text-lg">₹{Number(item.rate).toFixed(0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-16 pt-6 border-t-2 border-slate-100 text-[11px] text-center text-slate-400 uppercase tracking-[0.2em] font-black">
            *** Rates Subject to Change Today ***
          </div>
        </div>
      </div>

      {/* Main UI Header */}
      <div className="flex items-center justify-between border-b pb-3 gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-bold">Items Matrix</h2>
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline" size="sm" className="relative h-9 gap-2">
                <ShoppingCart className="h-4 w-4" /> Cart
                {cart.length > 0 && <span className="absolute -top-1 -right-1 bg-primary text-primary-foreground text-[10px] rounded-full h-4 w-4 flex items-center justify-center font-bold">{cart.length}</span>}
              </Button>
            </SheetTrigger>
            <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2"><ReceiptText className="h-5 w-5" /> Quote Builder</SheetTitle>
                <SheetDescription>Configure party name and quantities before exporting.</SheetDescription>
              </SheetHeader>
              <div className="py-6 space-y-6">
                <div className="space-y-1.5"><Label>Party Name</Label><Input placeholder="Customer/Business name..." value={partyName} onChange={(e) => setPartyName(e.target.value)} /></div>
                {cart.length === 0 ? <div className="text-center py-10 text-muted-foreground text-sm">No items in cart.</div> : (
                  <div className="space-y-3">
                    {cart.map((item) => (
                      <div key={item.id} className="p-3 border rounded-lg bg-muted/30 space-y-2">
                        <div className="flex justify-between items-start">
                          <div className="truncate"><p className="text-[10px] font-bold text-muted-foreground uppercase">{item.sectionName}</p><p className="text-sm font-semibold truncate">{item.name}</p></div>
                          <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => toggleCart(item, "")}><Trash2 className="h-3.5 w-3.5" /></Button>
                        </div>
                        <div className="grid grid-cols-2 gap-3 pt-2 border-t border-dashed">
                          <div className="space-y-1"><Label className="text-[10px]">Qty (e.g. 10T)</Label><Input value={item.qty} onChange={(e) => updateCartQty(item.id, e.target.value)} className="h-8 text-xs" /></div>
                          <div className="space-y-1 text-right"><Label className="text-[10px]">Adjusted Rate</Label><Input type="number" value={item.rate} onChange={(e) => updateCartRate(item.id, Number(e.target.value))} className="h-8 text-right font-mono text-xs" /></div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <SheetFooter className="flex-col gap-2 mt-auto border-t pt-6">
                <div className="grid grid-cols-2 gap-2 w-full">
                  <Button disabled={cart.length === 0} onClick={handleExportCartPDF} variant="outline" className="gap-2"><Download className="h-4 w-4" /> PDF</Button>
                  <Button disabled={cart.length === 0} onClick={handleExportCartImage} className="gap-2"><ImageIcon className="h-4 w-4" /> Image</Button>
                </div>
                <Button variant="ghost" className="w-full text-xs" onClick={() => setCart([])} disabled={cart.length === 0}>Clear Cart</Button>
              </SheetFooter>
            </SheetContent>
          </Sheet>
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <Input placeholder="Search items..." value={q} onChange={(e) => setQ(e.target.value)} className="w-32 md:w-48 h-9" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button size="sm" className="h-9 gap-1.5"><Plus className="h-4 w-4" /> Add</Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => { setItemForm({ id: "", name: "", section_id: sections.data?.[0]?.id || "", gauge_diff: 0, available_qty: 0, last_purchase_rate: "" }); setIsItemDialogOpen(true); }}>Add Product</DropdownMenuItem>
              <DropdownMenuItem onClick={() => { setSectionForm({ id: "", name: "", factory_id: factories.data?.[0]?.id || "" }); setIsSectionDialogOpen(true); }}>Add Section</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button onClick={() => setIsEditingGauges(!isEditingGauges)} variant={isEditingGauges ? "default" : "outline"} size="sm" className="h-9 hidden md:flex"><Sliders className="mr-2 h-4 w-4" /> {isEditingGauges ? "Finish" : "Edit Gauges"}</Button>
          <Popover>
            <PopoverTrigger asChild><Button variant="outline" size="sm" className="h-9"><FileText className="h-4 w-4" /></Button></PopoverTrigger>
            <PopoverContent align="end" className="w-64 space-y-3">
              <div className="text-sm font-bold">PDF Export Options</div>
              <div className="space-y-2">
                {ALL_COLS.map(c => (
                  <div key={c.key} className="flex items-center gap-2">
                    <Checkbox id={c.key} checked={pdfCols.includes(c.key)} onCheckedChange={(v) => setPdfCols(p => v ? [...p, c.key] : p.filter(k => k !== c.key))} />
                    <Label htmlFor={c.key} className="text-xs cursor-pointer">{c.label}</Label>
                  </div>
                ))}
              </div>
              <Button onClick={handleExportMainPDF} size="sm" className="w-full gap-2"><FileDown className="h-3.5 w-3.5" /> Full Report</Button>
            </PopoverContent>
          </Popover>
          <Button onClick={handleExportCSV} variant="outline" size="sm" className="h-9"><FileDown className="h-4 w-4" /></Button>
        </div>
      </div>

      {/* 💻 DESKTOP MATRIX TABLE */}
      <div className="hidden md:block space-y-4">
        {grouped.map(({ section, activeTodayFactory, activeFacBasic, activeFacAdder, topSauda, rows }) => (
          <Card key={section.id} id={`section-${section.id}`} className="overflow-visible">
            <div className="sticky top-14 z-20 bg-card border-b p-4 flex items-center justify-between rounded-t-lg">
              <div>
                <h3 className="text-base font-bold flex items-center gap-2">
                  {section.name}
                  <Button onClick={() => { setSectionForm({ id: section.id, name: section.name, factory_id: section.factory_id || "" }); setIsSectionDialogOpen(true); }} variant="ghost" size="icon" className="h-6 w-6"><Edit className="h-3.5 w-3.5" /></Button>
                </h3>
                <span className="text-xs text-muted-foreground">{activeTodayFactory?.name} (Basic: ₹{activeFacBasic} + Adder: ₹{activeFacAdder})</span>
              </div>
              <div className="flex gap-4">
                <div className="flex flex-col gap-1">
                  <Label className="text-[10px] text-muted-foreground">Reference Factory</Label>
                  <Select value={pickedTodayFactory[section.id] ?? section.factory_id} onValueChange={(v) => setPickedTodayFactory(p => ({ ...p, [section.id]: v }))}><SelectTrigger className="h-8 w-44 text-xs"><SelectValue /></SelectTrigger><SelectContent>{factories.data?.map((f: any) => (<SelectItem key={f.id} value={f.id}>{f.name} (₹{Number(f.basic_rate)+Number(f.adder)})</SelectItem>))}</SelectContent></Select>
                </div>
                {allOpenSaudas.length > 0 && (
                  <div className="flex flex-col gap-1">
                    <Label className="text-[10px] text-muted-foreground">Select Sauda</Label>
                    <Select value={pickedSauda[section.id] ?? topSauda?.id ?? ""} onValueChange={(v) => setPickedSauda(p => ({ ...p, [section.id]: v }))}><SelectTrigger className="h-8 w-44 text-xs"><SelectValue /></SelectTrigger><SelectContent>{allOpenSaudas.map(o => (<SelectItem key={o.id} value={o.id}>{o.party} ({o.pending}T)</SelectItem>))}</SelectContent></Select>
                  </div>
                )}
              </div>
            </div>
            <div className="px-4 py-2 flex text-[10px] font-black text-muted-foreground bg-muted/20 border-b uppercase tracking-tighter">
              <div className="w-[25%]">Item Name</div><div className="w-[10%] text-right pr-4">Gauge</div><div className="w-[13%] text-right">Today Rate</div><div className="w-[13%] text-right">Sauda Rate</div><div className="w-[13%] text-right text-primary">Party Rate</div><div className="w-[13%] text-right">Stock Qty</div><div className="w-[13%] text-right pr-1">Last Rate</div>
            </div>
            <CardContent className="p-0 divide-y">
              {rows.map(r => {
                const isInCart = cart.some(ci => ci.id === r.id);
                return (
                  <div key={r.id} className={`flex px-4 py-2.5 items-center hover:bg-muted/5 transition-colors group ${isInCart ? "bg-primary/[0.03]" : ""}`}>
                    <div className="w-[25%] flex items-center gap-2">
                      <button onClick={() => toggleCart(r, section.name)} className={`p-1.5 rounded-md ${isInCart ? "text-primary bg-primary/10" : "text-muted-foreground hover:bg-muted"}`}><ShoppingCart className="h-3.5 w-3.5" /></button>
                      <span className="font-medium text-slate-900">{r.name}</span>
                      <Button onClick={() => { setItemForm({ id: r.id, name: r.name, section_id: r.section_id, gauge_diff: r.gauge_diff, available_qty: Number(r.available_qty), last_purchase_rate: r.last_purchase_rate ? String(r.last_purchase_rate) : "" }); setIsItemDialogOpen(true); }} variant="ghost" size="icon" className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity"><Edit className="h-3 w-3" /></Button>
                    </div>
                    <div className="w-[10%] text-right pr-4 text-muted-foreground font-mono">{isEditingGauges ? <Input type="number" value={r.gauge_diff} onChange={(e) => setLocalGauges(p => ({ ...p, [r.id]: Number(e.target.value) }))} className="h-7 w-16 text-right ml-auto" /> : (r.gauge_diff > 0 ? `+${r.gauge_diff}` : r.gauge_diff)}</div>
                    <div className="w-[13%] text-right font-mono font-semibold">{r.today.toFixed(0)}</div>
                    <div className="w-[13%] text-right font-mono text-muted-foreground">{r.sauda?.toFixed(0) ?? "—"}</div>
                    <div className="w-[13%] text-right font-mono font-black text-primary">{r.party.toFixed(0)}</div>
                    <div className="w-[13%] text-right font-semibold text-slate-700">{Number(r.available_qty).toFixed(1)} MT</div>
                    <div className="w-[13%] text-right font-mono text-[11px] pr-1">{r.last_purchase_rate ?? "—"}</div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 📱 MOBILE MATRIX TABLE */}
      <div className="block md:hidden space-y-4">
        {grouped.map(({ section, activeTodayFactory, rows }) => (
          <div key={section.id} id={`section-${section.id}`} className="border rounded-lg bg-background shadow-sm overflow-hidden">
            <div className="bg-slate-50 p-3 border-b flex flex-col gap-2">
              <div className="flex justify-between items-center"><h3 className="font-bold text-xs">{section.name}</h3><button onClick={() => { setSectionForm({ id: section.id, name: section.name, factory_id: section.factory_id || "" }); setIsSectionDialogOpen(true); }}><Edit className="h-3.5 w-3.5 text-muted-foreground" /></button></div>
              <Select value={pickedTodayFactory[section.id] ?? section.factory_id} onValueChange={(v) => setPickedTodayFactory(p => ({ ...p, [section.id]: v }))}><SelectTrigger className="h-7 text-[10px]"><SelectValue /></SelectTrigger><SelectContent>{factories.data?.map((f: any) => (<SelectItem key={f.id} value={f.id} className="text-[10px]">{f.name} (₹{Number(f.basic_rate)+Number(f.adder)})</SelectItem>))}</SelectContent></Select>
            </div>
            <table className="w-full text-[10px] table-fixed border-collapse">
              <thead className="bg-muted/30 border-b font-bold uppercase text-muted-foreground">
                <tr><th className="py-2 pl-2 w-[35%] text-left">Item</th><th className="text-right w-[18%]">Today</th><th className="text-right w-[18%] text-primary">Party</th><th className="text-right pr-2 w-[15%]">Stock</th></tr>
              </thead>
              <tbody className="divide-y">
                {rows.map(r => {
                  const isInCart = cart.some(ci => ci.id === r.id);
                  return (
                    <tr key={r.id} className={isInCart ? "bg-primary/5" : ""}>
                      <td className="py-3 pl-2 flex items-center gap-1.5 overflow-hidden"><button onClick={() => toggleCart(r, section.name)} className={isInCart ? "text-primary" : "text-muted-foreground"}><ShoppingCart className="h-3 w-3" /></button><span className="truncate font-medium">{r.name}</span></td>
                      <td className="text-right font-mono">{r.today.toFixed(0)}</td>
                      <td className="text-right font-mono font-bold text-primary">{r.party.toFixed(0)}</td>
                      <td className="text-right pr-2">{Number(r.available_qty).toFixed(1)}t</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      {/* CRUD DIALOGS */}
      <Dialog open={isSectionDialogOpen} onOpenChange={setIsSectionDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{sectionForm.id ? "Edit Section" : "Create New Section"}</DialogTitle></DialogHeader>
          <form onSubmit={handleSaveSection} className="space-y-4">
            <div className="space-y-1"><Label>Section Name</Label><Input value={sectionForm.name} onChange={e => setSectionForm(p => ({ ...p, name: e.target.value }))} required /></div>
            <div className="space-y-1"><Label>Default Factory</Label><Select value={sectionForm.factory_id} onValueChange={v => setSectionForm(p => ({ ...p, factory_id: v }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{factories.data?.map((f: any) => (<SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>))}</SelectContent></Select></div>
            <DialogFooter><Button type="submit" disabled={saving}>Save Section</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={isItemDialogOpen} onOpenChange={setIsItemDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{itemForm.id ? "Edit Item" : "Add New Item"}</DialogTitle></DialogHeader>
          <form onSubmit={handleSaveItem} className="space-y-4">
            <div className="space-y-1"><Label>Item Name / Size</Label><Input value={itemForm.name} onChange={e => setItemForm(p => ({ ...p, name: e.target.value }))} required /></div>
            <div className="space-y-1"><Label>Section Group</Label><Select value={itemForm.section_id} onValueChange={v => setItemForm(p => ({ ...p, section_id: v }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{sections.data?.map((s: any) => (<SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>))}</SelectContent></Select></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label>Gauge Difference</Label><Input type="number" value={itemForm.gauge_diff} onChange={e => setItemForm(p => ({ ...p, gauge_diff: Number(e.target.value) }))} /></div>
              <div className="space-y-1"><Label>Current Stock (MT)</Label><Input type="number" step="0.01" value={itemForm.available_qty} onChange={e => setItemForm(p => ({ ...p, available_qty: Number(e.target.value) }))} /></div>
            </div>
            <div className="space-y-1"><Label>Last Purchase Rate (Optional)</Label><Input type="number" value={itemForm.last_purchase_rate} onChange={e => setItemForm(p => ({ ...p, last_purchase_rate: e.target.value }))} /></div>
            <DialogFooter><Button type="submit" disabled={saving}>Save Item Details</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* FAB List Navigation */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button size="icon" className="fixed bottom-6 right-6 h-12 w-12 rounded-full shadow-2xl z-50"><List /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top" className="w-52">
          <DropdownMenuLabel>Jump to Section</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {grouped.map(g => (<DropdownMenuItem key={g.section.id} onSelect={() => document.getElementById(`section-${g.section.id}`)?.scrollIntoView({ behavior: 'smooth' })}>{g.section.name}</DropdownMenuItem>))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
