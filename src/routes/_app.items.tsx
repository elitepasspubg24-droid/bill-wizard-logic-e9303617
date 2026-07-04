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
  qty?: number;
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

  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartPartyName, setCartPartyName] = useState("");

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
      return [...prev, { id: item.id, name: item.name, rate: item.party, sectionName, qty: 0 }];
    });
  };

  const updateCartRate = (id: string, rate: number) => {
    setCart((prev) => prev.map((i) => (i.id === id ? { ...i, rate } : i)));
  };

  const updateCartQty = (id: string, qty: number) => {
    setCart((prev) => prev.map((i) => (i.id === id ? { ...i, qty } : i)));
  };

  const handleExportCartPDF = () => {
    if (cart.length === 0) return;
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    doc.setFontSize(18);
    doc.text(`Quotation - ${cartPartyName || "Client"}`, 40, 50);
    doc.setFontSize(10);
    doc.text(`Date: ${new Date().toLocaleDateString()}`, 40, 65);

    const body = cart.map((i) => [i.name, i.qty || 0, `Rs. ${i.rate.toFixed(0)}`]);
    autoTable(doc, {
      startY: 80,
      head: [["Item Name", "Quantity", "Rate"]],
      body: body,
      theme: "grid",
      headStyles: { fillColor: [63, 81, 181] },
    });
    doc.save(`Quote_${cartPartyName || "Export"}.pdf`);
  };

  const handleExportCartImage = async () => {
    const element = document.getElementById("cart-table-print");
    if (!element) return;
    const canvas = await html2canvas(element, { backgroundColor: "#ffffff" });
    const data = canvas.toDataURL("image/png");
    const link = document.createElement("a");
    link.href = data;
    link.download = `Quote_${cartPartyName || "Export"}.png`;
    link.click();
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
            <SheetContent className="w-full sm:max-w-md overflow-y-auto">
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  <ReceiptText className="h-5 w-5" /> Selected Items Cart
                </SheetTitle>
              </SheetHeader>
              
              <div className="py-4 space-y-4">
                <Input placeholder="Enter Party Name" value={cartPartyName} onChange={(e) => setCartPartyName(e.target.value)} className="font-bold border-primary/50" />
                <div id="cart-table-print" className="space-y-3 p-2 bg-white">
                  {cart.length === 0 ? (
                    <div className="text-center py-10 text-muted-foreground text-sm">Your cart is empty.</div>
                  ) : (
                    cart.map((item) => (
                      <div key={item.id} className="flex items-center justify-between gap-3 p-3 border rounded-lg bg-muted/30">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold truncate">{item.name}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Input 
                            type="number" 
                            placeholder="Qty" 
                            className="h-8 w-16 text-center" 
                            onChange={(e) => updateCartQty(item.id, Number(e.target.value))}
                          />
                          <Input 
                            type="number" 
                            value={item.rate} 
                            onChange={(e) => updateCartRate(item.id, Number(e.target.value))}
                            className="h-8 w-20 text-right font-bold"
                          />
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => toggleCart(item, "")}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <SheetFooter className="flex-col gap-2 mt-auto border-t pt-6">
                <Button onClick={handleExportCartPDF} className="w-full gap-2">
                  <FileDown className="h-4 w-4" /> Export PDF
                </Button>
                <Button onClick={handleExportCartImage} variant="secondary" className="w-full gap-2">
                  <ImageIcon className="h-4 w-4" /> Export Image
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
        </div>
      </div>

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
                        </div>
                      </div>
                    </div>
                  </td>
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
                        </div>
                      </td>
                      <td className="py-2 px-1 text-right font-mono font-bold text-primary whitespace-nowrap">{r.today.toFixed(0)}</td>
                    </tr>
                   );
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      <div className="hidden md:block space-y-4">
        {grouped.map(({ section, activeTodayFactory, activeFacBasic, activeFacAdder, topSauda, rows }) => (
          <Card key={section.id} id={`section-${section.id}`} className="scroll-mt-20 overflow-visible">
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
                      </div>
                      <div className="w-[13%] text-right font-mono font-bold text-primary">{r.today.toFixed(0)}</div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={isSectionDialogOpen} onOpenChange={setIsSectionDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Section Manager</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSaveSection} className="space-y-4 py-2">
            <Input value={sectionForm.name} onChange={(e) => setSectionForm(p => ({ ...p, name: e.target.value }))} placeholder="Section Name" />
            <DialogFooter>
              <Button type="submit" disabled={saving}>Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={isItemDialogOpen} onOpenChange={setIsItemDialogOpen}>
        <DialogContent className="sm:max-w-[450px]">
          <DialogHeader>
            <DialogTitle>Item Manager</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSaveItem} className="space-y-4 py-2">
            <Input value={itemForm.name} onChange={(e) => setItemForm(p => ({ ...p, name: e.target.value }))} placeholder="Item Name" />
            <DialogFooter>
              <Button type="submit" disabled={saving}>Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
