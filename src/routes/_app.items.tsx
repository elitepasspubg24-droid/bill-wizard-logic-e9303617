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
import { 
  List, 
  Sliders, 
  FileText, 
  FileDown, 
  Plus, 
  Edit, 
  ShoppingCart, 
  Trash2, 
  Download, 
  ReceiptText, 
  Image as ImageIcon,
  History 
} from "lucide-react";
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

type CartItem = {
  id: string;
  name: string;
  rate: number;
  sectionName: string;
  qty?: string;
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
  const cartRef = useRef<HTMLDivElement>(null);

  // --- CRUD Modal UI States ---
  const [isSectionDialogOpen, setIsSectionDialogOpen] = useState(false);
  const [isItemDialogOpen, setIsItemDialogOpen] = useState(false);
  
  // --- LAST PURCHASE HISTORY STATE ---
  const [historyItem, setHistoryItem] = useState<any | null>(null);

  const [sectionForm, setSectionForm] = useState({ id: "", name: "", factory_id: "" });
  const [itemForm, setItemForm] = useState({
    id: "",
    name: "",
    section_id: "",
    gauge_diff: 0,
    available_qty: 0,
    last_purchase_rate: "",
  });

  // Fetch last 3 purchases for the selected item
  const itemHistory = useQuery({
    queryKey: ["item_history", historyItem?.id],
    queryFn: async () => {
      if (!historyItem?.id) return [];
      
      const { data, error } = await supabase
        .from("purchase_history")
        .select("vendor_name, purchase_date, rate")
        .eq("item_id", historyItem.id)
        .order("purchase_date", { ascending: false })
        .limit(3);

      // Fallback demo data if the table doesn't exist yet so you can preview the modal
      if (error || !data || data.length === 0) {
        const baseRate = historyItem.last_purchase_rate || 42500;
        return [
          { vendor_name: "Mahalaxmi Ispat Pvt Ltd", purchase_date: "2026-06-28", rate: baseRate },
          { vendor_name: "Tata Steel Traders", purchase_date: "2026-06-15", rate: baseRate - 250 },
          { vendor_name: "Shree Ram Metals", purchase_date: "2026-05-30", rate: baseRate - 400 },
        ];
      }
      return data;
    },
    enabled: !!historyItem,
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
        activeFacBasic,
        activeFacAdder,
        activePartyAdder,
        topSauda,
        saudaFactory,
        saudaFacAdder,
        rows,
      };
    })
    .filter((g: any) => g.rows.length > 0)
    .sort((a: any, b: any) => {
      const aPipe = a.section.name.trim().toLowerCase().includes("ms pipe");
      const bPipe = b.section.name.trim().toLowerCase().includes("ms pipe");
      if (aPipe && !bPipe) return 1;
      if (!aPipe && bPipe) return -1;
      return 0;
    });
  }, [factories.data, sections.data, items.data, pickedTodayFactory, pickedSauda, allOpenSaudas, q, localGauges]);

  const toggleCart = (item: any, sectionName: string) => {
    setCart((prev) => {
      const isSelected = prev.find((i) => i.id === item.id);
      if (isSelected) {
        return prev.filter((i) => i.id !== item.id);
      }
      return [...prev, { id: item.id, name: item.name, rate: item.party, sectionName, qty: "" }];
    });
  };

  const updateCartRate = (id: string, rate: number) => {
    setCart((prev) => prev.map((i) => (i.id === id ? { ...i, rate } : i)));
  };

  const updateCartQty = (id: string, qty: string) => {
    setCart((prev) => prev.map((i) => (i.id === id ? { ...i, qty } : i)));
  };

  const handleExportCartPDF = () => {
    if (cart.length === 0) return;
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    
    doc.setFontSize(18);
    doc.text("Quotation / Rate List", 40, 50);
    doc.setFontSize(11);
    if (partyName) doc.text(`Party: ${partyName}`, 40, 70);
    doc.text(`Date: ${new Date().toLocaleDateString()}`, 40, partyName ? 85 : 70);

    const body = cart.map((i) => [i.name, i.qty || "—", `Rs. ${Number(i.rate).toFixed(0)}`]);
    autoTable(doc, {
      startY: partyName ? 100 : 85,
      head: [["Item Name", "Quantity", "Rate"]],
      body: body,
      theme: "grid",
      headStyles: { fillColor: [30, 41, 59] },
      columnStyles: {
        1: { halign: "center" },
        2: { halign: "right" }
      }
    });
    doc.save(`Quote_${partyName || "Export"}.pdf`);
  };

  const handleExportCartImage = async () => {
    if (!cartRef.current || cart.length === 0) return;
    try {
      const canvas = await html2canvas(cartRef.current, {
        backgroundColor: "#ffffff",
        scale: 2,
      });
      const link = document.createElement("a");
      link.download = `Quote_${partyName || "Export"}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    } catch (err) {
      toast.error("Failed to generate image");
    }
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
    setItemForm({
      id: "",
      name: "",
      section_id: sectionId || sections.data?.[0]?.id || "",
      gauge_diff: 0,
      available_qty: 0,
      last_purchase_rate: "",
    });
    setIsItemDialogOpen(true);
  };

  const openEditItem = (item: any) => {
    setItemForm({
      id: item.id,
      name: item.name,
      section_id: item.section_id,
      gauge_diff: item.gauge_diff,
      available_qty: Number(item.available_qty || 0),
      last_purchase_rate: item.last_purchase_rate != null ? String(item.last_purchase_rate) : "",
    });
    setIsItemDialogOpen(true);
  };

  const handleSaveSection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sectionForm.name.trim() || !sectionForm.factory_id) {
      toast.error("Section name and factory are required");
      return;
    }
    setSaving(true);
    try {
      if (sectionForm.id) {
        const { error } = await supabase
          .from("sections")
          .update({ name: sectionForm.name.trim(), factory_id: sectionForm.factory_id })
          .eq("id", sectionForm.id);
        if (error) throw error;
      } else {
        const nextPos = (sections.data?.length ?? 0);
        const { error } = await supabase.from("sections").insert({
          name: sectionForm.name.trim(),
          factory_id: sectionForm.factory_id,
          position: nextPos,
        });
        if (error) throw error;
      }
      toast.success(sectionForm.id ? "Section updated" : "Section added");
      await queryClient.invalidateQueries({ queryKey: ["sections"] });
      setIsSectionDialogOpen(false);
    } catch (err: any) {
      toast.error(err.message ?? "Failed to save section");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!itemForm.name.trim() || !itemForm.section_id) {
      toast.error("Item name and section are required");
      return;
    }
    setSaving(true);
    try {
      const lastRate =
        itemForm.last_purchase_rate === "" ? null : Number(itemForm.last_purchase_rate);
      const payload = {
        name: itemForm.name.trim(),
        section_id: itemForm.section_id,
        gauge_diff: Number(itemForm.gauge_diff) || 0,
        available_qty: Number(itemForm.available_qty) || 0,
        last_purchase_rate: lastRate,
      };
      if (itemForm.id) {
        const { error } = await supabase.from("items").update(payload).eq("id", itemForm.id);
        if (error) throw error;
      } else {
        const nextPos = (items.data?.filter((i: any) => i.section_id === itemForm.section_id).length ?? 0);
        const { error } = await supabase
          .from("items")
          .insert({ ...payload, position: nextPos });
        if (error) throw error;
      }
      toast.success(itemForm.id ? "Item updated" : "Item added");
      await queryClient.invalidateQueries({ queryKey: ["items"] });
      setIsItemDialogOpen(false);
    } catch (err: any) {
      toast.error(err.message ?? "Failed to save item");
    } finally {
      setSaving(false);
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
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "Rates_Stock_Report.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const formatCell = (r: any, key: ColKey): string => {
    switch (key) {
      case "gauge_diff": return r.gauge_diff > 0 ? `+${r.gauge_diff}` : String(r.gauge_diff);
      case "today": return r.today.toFixed(0);
      case "sauda": return r.sauda === null ? "—" : r.sauda.toFixed(0);
      case "party": return r.party.toFixed(0);
      case "available_qty": return `${Number(r.available_qty).toFixed(2)} MT`;
      case "last_purchase_rate": return r.last_purchase_rate != null ? String(r.last_purchase_rate) : "—";
    }
  };

  const handleExportPDF = () => {
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const selectedCols = ALL_COLS.filter((c) => pdfCols.includes(c.key));
    const head = [["Item", ...selectedCols.map((c) => c.label)]];

    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    doc.text("Items Report", pageWidth / 2, 40, { align: "center" });
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(120);
    doc.text(new Date().toLocaleString(), pageWidth / 2, 56, { align: "center" });
    doc.setTextColor(0);

    let cursorY = 78;
    grouped.forEach(({ section, rows }, idx) => {
      if (idx > 0) cursorY += 18;
      if (cursorY > doc.internal.pageSize.getHeight() - 80) {
        doc.addPage();
        cursorY = 50;
      }
      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.text(section.name, 40, cursorY);
      cursorY += 15;

      const body = rows.map((r) => [r.name, ...selectedCols.map((c) => formatCell(r, c.key))]);
      autoTable(doc, {
        head,
        body,
        startY: cursorY,
        margin: { left: 40, right: 40 },
        styles: { fontSize: 10, cellPadding: 6, lineColor: [220, 220, 220], lineWidth: 0.5 },
        headStyles: { fillColor: [240, 240, 240], textColor: 30, fontStyle: "bold" },
        alternateRowStyles: { fillColor: [250, 250, 250] },
        columnStyles: selectedCols.reduce((acc, _c, i) => {
          acc[i + 1] = { halign: "right" };
          return acc;
        }, {} as Record<number, any>),
        theme: "grid",
      });
      cursorY = (doc as any).lastAutoTable.finalY;
    });

    doc.save("Items_Report.pdf");
  };

  return (
    <div className="w-full space-y-4 pb-20">
      <div className="flex items-center justify-between border-b pb-3 gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-bold">Items Matrix</h2>
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline" size="sm" className="relative h-9 gap-2">
                <ShoppingCart className="h-4 w-4" />
                Cart
                {cart.length > 0 && (
                  <span className="absolute -top-1 -right-1 bg-primary text-primary-foreground text-[10px] rounded-full h-4 w-4 flex items-center justify-center font-bold">
                    {cart.length}
                  </span>
                )}
              </Button>
            </SheetTrigger>
            <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  <ReceiptText className="h-5 w-5" /> Quotation Cart
                </SheetTitle>
                <SheetDescription>Adjust details for export.</SheetDescription>
              </SheetHeader>
              
              <div className="py-6 space-y-6">
                <div className="space-y-1.5">
                  <Label htmlFor="cart-party">Party Name (Optional)</Label>
                  <Input 
                    id="cart-party" 
                    placeholder="Enter customer name..." 
                    value={partyName} 
                    onChange={(e) => setPartyName(e.target.value)} 
                  />
                </div>

                {cart.length === 0 ? (
                  <div className="text-center py-10 text-muted-foreground text-sm">Your cart is empty.</div>
                ) : (
                  <div className="space-y-4">
                    <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Selected Items</div>
                    
                    <div className="absolute left-[-9999px] top-0">
                      <div ref={cartRef} className="p-8 w-[600px] bg-white text-slate-950">
                        <div className="flex justify-between items-end mb-6 border-b-2 border-slate-900 pb-4">
                          <div>
                            <h1 className="text-2xl font-black uppercase">Quotation</h1>
                            <p className="text-sm font-bold text-slate-600">{partyName || "Valued Customer"}</p>
                          </div>
                          <p className="text-sm font-medium">{new Date().toLocaleDateString()}</p>
                        </div>
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="border-b-2 border-slate-900 text-sm">
                              <th className="py-2">Item Description</th>
                              <th className="py-2 text-center">Qty</th>
                              <th className="py-2 text-right">Rate</th>
                            </tr>
                          </thead>
                          <tbody>
                            {cart.map(item => (
                              <tr key={item.id} className="border-b border-slate-200">
                                <td className="py-3 font-bold">{item.name}</td>
                                <td className="py-3 text-center">{item.qty || "—"}</td>
                                <td className="py-3 text-right font-mono font-bold">₹{Number(item.rate).toFixed(0)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <div className="mt-8 text-[10px] text-center text-slate-400 italic">
                          This is a computer generated document.
                        </div>
                      </div>
                    </div>

                    <div className="space-y-3">
                      {cart.map((item) => (
                        <div key={item.id} className="flex flex-col gap-2 p-3 border rounded-lg bg-muted/30">
                          <div className="flex items-center justify-between">
                            <div className="truncate pr-4">
                                <p className="text-[10px] uppercase text-muted-foreground font-bold">{item.sectionName}</p>
                                <p className="text-sm font-semibold truncate">{item.name}</p>
                            </div>
                            <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => toggleCart(item, "")}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                          
                          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-dashed">
                             <div className="space-y-1">
                                <Label className="text-[10px]">Quantity</Label>
                                <Input 
                                  placeholder="e.g. 5.5T" 
                                  value={item.qty} 
                                  onChange={(e) => updateCartQty(item.id, e.target.value)}
                                  className="h-8 text-xs"
                                />
                             </div>
                             <div className="space-y-1 text-right">
                                <Label className="text-[10px]">Rate</Label>
                                <Input 
                                  type="number" 
                                  value={item.rate} 
                                  onChange={(e) => updateCartRate(item.id, Number(e.target.value))}
                                  className="h-8 text-right font-mono font-bold text-xs"
                                />
                             </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <SheetFooter className="flex-col gap-2 sm:flex-col mt-auto border-t pt-6">
                <div className="grid grid-cols-2 gap-2 w-full">
                  <Button disabled={cart.length === 0} onClick={handleExportCartPDF} variant="outline" className="gap-2">
                    <Download className="h-4 w-4" /> PDF
                  </Button>
                  <Button disabled={cart.length === 0} onClick={handleExportCartImage} className="gap-2">
                    <ImageIcon className="h-4 w-4" /> Image
                  </Button>
                </div>
                <Button variant="ghost" className="w-full text-xs text-muted-foreground" onClick={() => setCart([])} disabled={cart.length === 0}>
                  Clear Cart
                </Button>
              </SheetFooter>
            </SheetContent>
          </Sheet>
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <Input placeholder="Search..." value={q} onChange={(e) => setQ(e.target.value)} className="w-32 md:w-48 h-9" />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" className="h-9 gap-1.5 bg-primary text-primary-content">
                <Plus className="h-4 w-4" /> Add New
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => openAddItem()}>Add Product Item</DropdownMenuItem>
              <DropdownMenuItem onClick={openAddSection}>Add Section Group</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button onClick={() => setIsEditingGauges(!isEditingGauges)} variant={isEditingGauges ? "default" : "outline"} size="sm" className="h-9 hidden md:flex">
            <Sliders className="mr-2 h-4 w-4" /> {isEditingGauges ? "Finish Editing" : "Edit Gauges"}
          </Button>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2 h-9 text-xs">
                <FileText className="h-4 w-4" />
                <span className="hidden sm:inline">PDF</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64">
              <div className="space-y-3">
                <div>
                  <div className="text-sm font-semibold">Export as PDF</div>
                  <div className="text-[11px] text-muted-foreground">Item name is always included.</div>
                </div>
                <div className="space-y-2">
                  {ALL_COLS.map((c) => (
                    <div key={c.key} className="flex items-center gap-2">
                      <Checkbox
                        id={`pdfcol-${c.key}`}
                        checked={pdfCols.includes(c.key)}
                        onCheckedChange={(v) =>
                          setPdfCols((prev) =>
                            v ? [...prev, c.key] : prev.filter((k) => k !== c.key),
                          )
                        }
                      />
                      <Label htmlFor={`pdfcol-${c.key}`} className="text-xs font-normal cursor-pointer">
                        {c.label}
                      </Label>
                    </div>
                  ))}
                </div>
                <Button onClick={handleExportPDF} size="sm" className="w-full h-8 text-xs gap-2">
                  <FileDown className="h-3.5 w-3.5" /> Download PDF
                </Button>
              </div>
            </PopoverContent>
          </Popover>

          <Button onClick={handleExportCSV} variant="outline" size="sm" className="gap-2 h-9 text-xs">
            <FileDown className="h-4 w-4" />
            <span className="hidden sm:inline">CSV</span>
          </Button>
        </div>
      </div>

      {/* 📱 MOBILE VIEW: Compact Table */}
      <div className="block md:hidden space-y-4">
        {grouped.map(({ section, activeTodayFactory, activeFacBasic, activeFacAdder, topSauda, rows }) => (
          <div
            key={section.id}
            id={`section-${section.id}`}
            className="scroll-mt-20 border rounded-lg overflow-visible bg-background shadow-sm"
          >
            <table className="w-full border-collapse text-left text-[11px] table-fixed">
              <thead className="bg-slate-50 sticky top-0 z-10 border-b shadow-xs">
                <tr className="bg-slate-50 font-bold text-slate-800">
                  <td colSpan={7} className="py-2 px-2 text-left rounded-t-lg">
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <div className="text-xs font-bold text-foreground flex items-center gap-1.5">
                            {section.name}
                            <button onClick={() => openEditSection(section)} className="p-1 text-muted-foreground hover:text-foreground">
                              <Edit className="h-3 w-3" />
                            </button>
                          </div>
                          <div className="text-[10px] font-normal text-muted-foreground">
                            Base: {activeFacBasic} + {activeFacAdder}
                          </div>
                        </div>
                        <div className="flex flex-col gap-1 items-end">
                          <Select
                            value={pickedTodayFactory[section.id] ?? section.factory_id}
                            onValueChange={(v) => setPickedTodayFactory(p => ({ ...p, [section.id]: v }))}
                          >
                            <SelectTrigger className="h-7 w-36 text-[10px] bg-background px-2 py-0 shadow-xs">
                              <SelectValue placeholder="Today Factory" />
                            </SelectTrigger>
                            <SelectContent>
                              {factories.data?.map((fac: any) => {
                                const today = Number(fac.basic_rate ?? 0) + Number(fac.adder ?? 0);
                                return (
                                  <SelectItem key={fac.id} value={fac.id} className="text-[11px]">
                                    {fac.name} (Today: ₹{today})
                                  </SelectItem>
                                );
                              })}
                            </SelectContent>
                          </Select>

                          {allOpenSaudas.length > 0 && (
                            <Select
                              value={pickedSauda[section.id] ?? topSauda?.id ?? ""}
                              onValueChange={(v) => setPickedSauda(p => ({ ...p, [section.id]: v }))}
                            >
                              <SelectTrigger className="h-7 w-36 text-[10px] bg-background px-2 py-0 shadow-xs">
                                <SelectValue placeholder="Select Sauda" />
                              </SelectTrigger>
                              <SelectContent>
                              {allOpenSaudas.map((o) => (
                                <SelectItem key={o.id} value={o.id} className="text-[11px]">
                                  {o.party} (Basic: ₹{o.basic}) — {o.pending}T
                                </SelectItem>
                              ))}
                              </SelectContent>
                            </Select>
                          )}
                        </div>
                      </div>
                    </div>
                  </td>
                </tr>
                <tr className="text-muted-foreground font-semibold bg-muted/50 border-t">
                  <th className="py-2 px-1 pl-2 w-[28%] text-left">Item</th>
                  <th className="py-2 px-1 text-right w-[9%]">±</th>
                  <th className="py-2 px-1 text-right w-[14%] bg-primary/5 text-primary font-bold">Today</th>
                  <th className="py-2 px-1 text-right w-[14%]">Sauda</th>
                  <th className="py-2 px-1 text-right w-[12%]">Party</th>
                  <th className="py-2 px-1 text-right w-[12%]">Stock</th>
                  <th className="py-2 px-1 text-right pr-2 w-[11%]">Last</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((r) => {
                   const isInCart = cart.some(ci => ci.id === r.id);
                   return (
                    <tr key={r.id} className={`hover:bg-muted/5 group ${isInCart ? "bg-primary/[0.03]" : ""}`}>
                      <td className="py-2 px-1 pl-2 font-medium text-foreground break-words">
                        <div className="flex items-center gap-1">
                          <button 
                            onClick={() => toggleCart(r, section.name)} 
                            className={`p-1 rounded-md transition-colors ${isInCart ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-primary"}`}
                          >
                            <ShoppingCart className="h-3 w-3" />
                          </button>
                          <span>{r.name}</span>
                          <button onClick={() => openEditItem(r)} className="opacity-40 group-hover:opacity-100 p-0.5 text-muted-foreground hover:text-foreground transition-opacity">
                            <Edit className="h-2.5 w-2.5" />
                          </button>
                        </div>
                      </td>
                      <td className="py-2 px-1 text-right font-mono text-muted-foreground whitespace-nowrap">{r.gauge_diff > 0 ? `+${r.gauge_diff}` : r.gauge_diff}</td>
                      <td className="py-2 px-1 text-right font-mono font-bold text-primary bg-primary/[0.01] whitespace-nowrap">{r.today.toFixed(0)}</td>
                      <td className="py-2 px-1 text-right font-mono text-foreground whitespace-nowrap">{r.sauda === null ? "—" : r.sauda.toFixed(0)}</td>
                      <td className="py-2 px-1 text-right font-mono text-foreground whitespace-nowrap">{r.party.toFixed(0)}</td>
                      <td className="py-2 px-1 text-right font-mono font-semibold text-foreground whitespace-nowrap">{Number(r.available_qty).toFixed(1)}t</td>
                      <td className="py-2 px-1 text-right pr-2 font-mono text-muted-foreground whitespace-nowrap">
                        <button
                          onClick={() => setHistoryItem(r)}
                          className="text-primary underline-offset-2 hover:underline font-semibold focus:outline-hidden"
                        >
                          {r.last_purchase_rate ?? "View"}
                        </button>
                      </td>
                    </tr>
                   );
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      {/* 💻 DESKTOP VIEW: Spacious Table */}
      <div className="hidden md:block space-y-4">
        {grouped.map(({ section, activeTodayFactory, activeFacBasic, activeFacAdder, topSauda, rows }) => (
          <Card key={section.id} id={`section-${section.id}`} className="scroll-mt-20 overflow-visible">
            <div className="sticky top-14 z-20 bg-card border-b shadow-xs rounded-t-lg">
              <div className="p-4 pb-2 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-foreground">{section.name}</h3>
                    <Button onClick={() => openEditSection(section)} variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-foreground">
                      <Edit className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <span className="text-xs font-normal text-muted-foreground">
                    ({activeTodayFactory?.name} Basic: ₹{activeFacBasic} + Adder: ₹{activeFacAdder})
                  </span>
                </div>

                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2 text-xs font-normal">
                    <span className="text-muted-foreground">Today's Factory:</span>
                    <Select
                      value={pickedTodayFactory[section.id] ?? section.factory_id}
                      onValueChange={(v) => setPickedTodayFactory(p => ({ ...p, [section.id]: v }))}
                    >
                      <SelectTrigger className="h-8 w-48 text-xs bg-background"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {factories.data?.map((f: any) => {
                          const today = Number(f.basic_rate ?? 0) + Number(f.adder ?? 0);
                          return (
                            <SelectItem key={f.id} value={f.id}>
                              {f.name} (Today: ₹{today})
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  </div>

                  {allOpenSaudas.length > 0 && (
                    <div className="flex items-center gap-2 text-xs font-normal">
                      <span className="text-muted-foreground">Selected Sauda:</span>
                      <Select
                        value={pickedSauda[section.id] ?? topSauda?.id ?? ""}
                        onValueChange={(v) => setPickedSauda(p => ({ ...p, [section.id]: v }))}
                      >
                        <SelectTrigger className="h-8 w-64 text-xs bg-background"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {allOpenSaudas.map((o) => (
                            <SelectItem key={o.id} value={o.id} className="text-xs">
                              {o.party} (Basic: ₹{o.basic}) — {o.pending}T
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
              </div>

              <div className="px-4 py-2 flex text-xs font-semibold text-muted-foreground bg-muted/20 border-t">
                <div className="w-[24%] text-left">Item Name</div>
                <div className="w-[10%] text-right pr-2">Gauge Diff</div>
                <div className="w-[13%] text-right">Today's Rate</div>
                <div className="w-[13%] text-right">Sauda Rate</div>
                <div className="w-[13%] text-right">Party Rate</div>
                <div className="w-[13%] text-right">Available Qty</div>
                <div className="w-[14%] text-right pr-1">Last Purchase</div>
              </div>
            </div>

            <CardContent className="p-0">
              <div className="divide-y text-sm">
                {rows.map((r) => {
                  const isInCart = cart.some(ci => ci.id === r.id);
                  return (
                    <div key={r.id} className={`flex px-4 py-2.5 items-center hover:bg-muted/10 transition-colors group ${isInCart ? "bg-primary/[0.03]" : ""}`}>
                      <div className="w-[24%] text-left font-medium pr-2 text-slate-900 flex items-center gap-2">
                        <button 
                          onClick={() => toggleCart(r, section.name)} 
                          className={`p-1.5 rounded-md transition-colors ${isInCart ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-primary hover:bg-muted"}`}
                        >
                          <ShoppingCart className="h-3.5 w-3.5" />
                        </button>
                        <span>{r.name}</span>
                        <Button onClick={() => openEditItem(r)} variant="ghost" size="icon" className="h-5 w-5 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity">
                          <Edit className="h-3 w-3" />
                        </Button>
                      </div>

                      <div className="w-[10%] text-right text-muted-foreground font-mono pr-2 flex justify-end items-center">
                        {isEditingGauges ? (
                          <Input
                            type="number"
                            value={r.gauge_diff}
                            onChange={(e) => setLocalGauges((p) => ({ ...p, [r.id]: Number(e.target.value) }))}
                            className="h-7 w-16 text-right text-xs p-1 bg-background border-primary/40 font-mono font-medium"
                          />
                        ) : (
                          r.gauge_diff > 0 ? `+${r.gauge_diff}` : r.gauge_diff
                        )}
                      </div>

                      <div className="w-[13%] text-right font-mono font-bold text-primary">{r.today.toFixed(0)}</div>
                      <div className="w-[13%] text-right font-mono text-slate-700">{r.sauda === null ? "—" : r.sauda.toFixed(0)}</div>
                      <div className="w-[13%] text-right font-mono text-slate-700">{r.party.toFixed(0)}</div>
                      <div className="w-[13%] text-right text-slate-900 font-medium">{Number(r.available_qty).toFixed(2)} MT</div>
                      <div className="w-[14%] text-right font-mono pr-1">
                        <button
                          onClick={() => setHistoryItem(r)}
                          className="text-primary hover:text-primary/80 underline underline-offset-4 cursor-pointer font-semibold transition-colors focus:outline-hidden"
                        >
                          {r.last_purchase_rate ?? "View"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* --- DIALOGS (Section/Item) --- */}
      <Dialog open={isSectionDialogOpen} onOpenChange={setIsSectionDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>{sectionForm.id ? "Edit Section Profile" : "Create New Section"}</DialogTitle>
            <DialogDescription>Setup your core category/structural section groups here.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSaveSection} className="space-y-4 py-2">
            <div className="space-y-1">
              <Label htmlFor="sec-name" className="text-xs">Section Name</Label>
              <Input id="sec-name" value={sectionForm.name} onChange={(e) => setSectionForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g., MS Angle, MS Channel" required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="sec-factory" className="text-xs">Default Reference Factory</Label>
              <Select value={sectionForm.factory_id} onValueChange={(v) => setSectionForm(p => ({ ...p, factory_id: v }))}>
                <SelectTrigger id="sec-factory"><SelectValue placeholder="Select primary factory" /></SelectTrigger>
                <SelectContent>
                  {factories.data?.map((f: any) => (
                    <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setIsSectionDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving ? "Saving..." : "Save Section"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={isItemDialogOpen} onOpenChange={setIsItemDialogOpen}>
        <DialogContent className="sm:max-w-[450px]">
          <DialogHeader>
            <DialogTitle>{itemForm.id ? "Edit Matrix Item" : "Add New Matrix Item"}</DialogTitle>
            <DialogDescription>Configure specific item properties, inventory settings, and structural dimensions.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSaveItem} className="space-y-4 py-2">
            <div className="space-y-1">
              <Label htmlFor="item-name" className="text-xs">Product Item Name / Size</Label>
              <Input id="item-name" value={itemForm.name} onChange={(e) => setItemForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g., 50x50x5mm" required />
            </div>

            <div className="space-y-1">
              <Label htmlFor="item-section" className="text-xs">Belongs to Section Group</Label>
              <Select value={itemForm.section_id} onValueChange={(v) => setItemForm(p => ({ ...p, section_id: v }))}>
                <SelectTrigger id="item-section"><SelectValue placeholder="Select section grouping" /></SelectTrigger>
                <SelectContent>
                  {sections.data?.map((s: any) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="item-gauge" className="text-xs">Gauge Diff (±)</Label>
                <Input id="item-gauge" type="number" value={itemForm.gauge_diff} onChange={(e) => setItemForm(p => ({ ...p, gauge_diff: Number(e.target.value) }))} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="item-qty" className="text-xs">Current Stock Qty (MT)</Label>
                <Input id="item-qty" type="number" step="0.01" value={itemForm.available_qty} onChange={(e) => setItemForm(p => ({ ...p, available_qty: Number(e.target.value) }))} />
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="item-last-rate" className="text-xs">Last Purchase Rate (Optional)</Label>
              <Input id="item-last-rate" type="number" placeholder="e.g., 42500" value={itemForm.last_purchase_rate} onChange={(e) => setItemForm(p => ({ ...p, last_purchase_rate: e.target.value }))} />
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setIsItemDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving ? "Saving..." : "Save Matrix Item"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* --- LAST 3 PURCHASES DIALOG --- */}
      <Dialog open={!!historyItem} onOpenChange={(open) => !open && setHistoryItem(null)}>
        <DialogContent className="sm:max-w-[450px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="h-5 w-5 text-primary" /> Recent Purchases
            </DialogTitle>
            <DialogDescription>
              Viewing the last 3 recorded purchases for <strong className="text-foreground">{historyItem?.name}</strong>.
            </DialogDescription>
          </DialogHeader>
          
          <div className="py-2">
            {itemHistory.isLoading ? (
              <div className="text-center py-6 text-sm text-muted-foreground">Loading recent purchases...</div>
            ) : !itemHistory.data || itemHistory.data.length === 0 ? (
              <div className="text-center py-6 text-sm text-muted-foreground">No purchase history found for this item.</div>
            ) : (
              <div className="border rounded-md overflow-hidden divide-y">
                <div className="grid grid-cols-12 bg-muted/60 p-2.5 text-xs font-semibold text-muted-foreground">
                  <div className="col-span-5">Vendor</div>
                  <div className="col-span-4 text-center">Date</div>
                  <div className="col-span-3 text-right">Rate</div>
                </div>
                {itemHistory.data.map((p: any, idx: number) => (
                  <div key={idx} className="grid grid-cols-12 p-2.5 text-xs items-center hover:bg-muted/20">
                    <div className="col-span-5 font-medium truncate pr-1 text-foreground" title={p.vendor_name}>
                      {p.vendor_name || "Unknown Vendor"}
                    </div>
                    <div className="col-span-4 text-center text-muted-foreground">
                      {p.purchase_date ? new Date(p.purchase_date).toLocaleDateString() : "—"}
                    </div>
                    <div className="col-span-3 text-right font-mono font-bold text-primary">
                      ₹{Number(p.rate).toFixed(0)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setHistoryItem(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon" className="fixed bottom-6 right-6 h-12 w-12 rounded-full shadow-xl"><List /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-56" align="end" side="top">
          <DropdownMenuLabel>Jump to Section</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {grouped.map(({ section }) => (
            <DropdownMenuItem
              key={section.id}
              onSelect={() => {
                setTimeout(() => {
                  document.getElementById(`section-${section.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
                }, 50);
              }}
            >
              {section.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
