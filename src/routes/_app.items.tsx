import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { List, FileDown, Factory, Sliders, FileText, Plus } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
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

export const Route = createFileRoute("/_app/items")({
  component: ItemsPage,
  head: () => ({ meta: [{ title: "Items Summary" }] }),
});

function ItemsPage() {
  const factories = useQuery({ queryKey: ["factories"], queryFn: fetchFactories });
  const sections = useQuery({ queryKey: ["sections"], queryFn: fetchSections });
  const items = useQuery({ queryKey: ["items"], queryFn: fetchItems });
  const saudas = useQuery({ queryKey: ["saudas"], queryFn: fetchSaudas });
  
  const [q, setQ] = useState("");
  const [pickedSauda, setPickedSauda] = useState<Record<string, string>>({});
  const [isEditing, setIsEditing] = useState(false);
  
  // Local state modifiers for inline edits
  const [localGauges, setLocalGauges] = useState<Record<string, number>>({});
  const [localNames, setLocalNames] = useState<Record<string, string>>({});
  const [localSections, setLocalSections] = useState<Record<string, string>>({});
  
  // Local state for dynamically added temporary matrix rows
  const [newItems, setNewItems] = useState<any[]>([]);
  const [pdfCols, setPdfCols] = useState<ColKey[]>(DEFAULT_PDF_COLS);

  // Form states for the "Add New Item" Dialog
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [newItemName, setNewItemName] = useState("");
  const [newItemSectionId, setNewItemSectionId] = useState("");
  const [newItemGaugeDiff, setNewItemGaugeDiff] = useState(0);

  const allOpenSaudas = useMemo(() => {
    const list: any[] = [];
    if (!saudas.data) return list;
    for (const s of saudas.data as any[]) {
      if (!s.factory_id || s.status === "done") continue;
      const itemsTotal = (s.sauda_items ?? []).reduce((a: number, r: any) => a + Number(r.qty || 0), 0);
      const total = Number(s.total_qty || 0) || itemsTotal;
      const pending = Math.max(0, total - Number(s.lifted_qty || 0));
      if (pending <= 0) continue;
      list.push({ id: s.id, basic: Number(s.sauda_basic), party: s.party_name, pending, factory_id: s.factory_id });
    }
    return list.sort((a, b) => b.pending - a.pending);
  }, [saudas.data]);

  const chosenByFactory = useMemo(() => {
    const map = new Map<string, { basic: number; party: string; pending: number; id: string; factory_id: string }>();
    if (!factories.data) return map;
    for (const f of factories.data) {
      const pickId = pickedSauda[f.id];
      const factoryDefault = allOpenSaudas.find((x) => x.factory_id === f.id);
      const picked = (pickId && allOpenSaudas.find((x) => x.id === pickId)) || factoryDefault || allOpenSaudas[0];
      if (picked) map.set(f.id, picked);
    }
    return map;
  }, [factories.data, allOpenSaudas, pickedSauda]);

  const grouped = useMemo(() => {
    if (!sections.data || !items.data || !factories.data) return [];
    const fmap = new Map(factories.data.map((f) => [f.id, f]));

    // Construct a unified items list combining fetched items + locally created custom additions
    const unifiedItems = [...items.data, ...newItems].map((i) => {
      const currentGaugeDiff = localGauges[i.id] !== undefined ? localGauges[i.id] : Number(i.gauge_diff || 0);
      const currentName = localNames[i.id] !== undefined ? localNames[i.id] : i.name;
      const currentSectionId = localSections[i.id] !== undefined ? localSections[i.id] : i.section_id;
      return {
        ...i,
        name: currentName,
        section_id: currentSectionId,
        gauge_diff: currentGaugeDiff,
      };
    });

    const list = sections.data.map((s) => {
      const f = fmap.get(s.factory_id);
      const baseToday = (f?.basic_rate ?? 0) + Number(s.adder);
      const top = chosenByFactory.get(s.factory_id);
      const baseSauda = top ? top.basic + Number(s.adder) : null;
      const baseParty = Number(s.party_basic);
      
      const rows = unifiedItems
        .filter((i) => i.section_id === s.id)
        .filter((i) => !q || i.name.toLowerCase().includes(q.toLowerCase()))
        .map((i) => {
          return {
            ...i,
            today: baseToday + i.gauge_diff,
            sauda: baseSauda === null ? null : baseSauda + i.gauge_diff,
            party: baseParty + i.gauge_diff,
          };
        });
      return { section: s, factory: f, top, rows };
    }).filter((g) => g.rows.length > 0 || isEditing);

    // Shifts any section containing "ms pipe" in its title dynamically to the bottom
    return [...list].sort((a, b) => {
      const aIsPipe = a.section.name.toLowerCase().includes("ms pipe");
      const bIsPipe = b.section.name.toLowerCase().includes("ms pipe");
      if (aIsPipe && !bIsPipe) return 1;
      if (!aIsPipe && bIsPipe) return -1;
      return 0;
    });
  }, [factories.data, sections.data, items.data, newItems, chosenByFactory, q, localGauges, localNames, localSections, isEditing]);

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
    grouped.forEach(({ section, factory, rows }, idx) => {
      if (idx > 0) cursorY += 18; // spacing between sections
      if (cursorY > doc.internal.pageSize.getHeight() - 80) {
        doc.addPage();
        cursorY = 50;
      }
      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.text(section.name, 40, cursorY);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(110);
      if (factory) doc.text(`${factory.name}`, 40, cursorY + 13);
      doc.setTextColor(0);
      cursorY += 20;

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

  const handleSaveNewItem = () => {
    if (!newItemName || !newItemSectionId) return;
    const itemObject = {
      id: `custom-item-${Date.now()}`,
      name: newItemName,
      section_id: newItemSectionId,
      gauge_diff: newItemGaugeDiff,
      available_qty: 0,
      last_purchase_rate: null,
    };
    setNewItems((prev) => [...prev, itemObject]);
    setNewItemName("");
    setNewItemSectionId("");
    setNewItemGaugeDiff(0);
    setIsAddDialogOpen(false);
  };

  return (
    <div className="w-full space-y-4">
      {/* Universal Sticky Control Heading Strip */}
      <div className="flex items-center justify-between gap-4 flex-wrap border-b pb-3">
        <div>
          <h2 className="text-xl md:text-2xl font-bold tracking-tight">Items Matrix</h2>
          <p className="text-xs md:text-sm text-muted-foreground hidden sm:block">
            Live calculations incorporating baseline configuration rules, section adders, and gauge variations.
          </p>
        </div>
        
        <div className="flex items-center gap-2 ml-auto">
          <Input placeholder="Search item…" value={q} onChange={(e) => setQ(e.target.value)} className="w-36 md:w-48 h-9 text-sm" />
          
          {/* Add Item Modal Dropdown Trigger */}
          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-2 h-9 text-xs">
                <Plus className="h-4 w-4" />
                <span>Add Item</span>
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
              <DialogHeader>
                <DialogTitle>Create Matrix Row Item</DialogTitle>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="item_name" className="text-xs font-semibold">Item Name</Label>
                  <Input
                    id="item_name"
                    value={newItemName}
                    onChange={(e) => setNewItemName(e.target.value)}
                    placeholder="e.g. 20mm Round Bar"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="item_section" className="text-xs font-semibold">Target Section Placement</Label>
                  <Select value={newItemSectionId} onValueChange={setNewItemSectionId}>
                    <SelectTrigger id="item_section">
                      <SelectValue placeholder="Select target section" />
                    </SelectTrigger>
                    <SelectContent>
                      {sections.data?.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="item_gauge" className="text-xs font-semibold">Initial Gauge Difference Modifier</Label>
                  <Input
                    id="item_gauge"
                    type="number"
                    value={newItemGaugeDiff}
                    onChange={(e) => setNewItemGaugeDiff(Number(e.target.value))}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button onClick={handleSaveNewItem} disabled={!newItemName || !newItemSectionId}>
                  Save Item
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Master Full-Field Editing Toggle Switch */}
          <Button 
            onClick={() => setIsEditing(!isEditing)} 
            variant={isEditing ? "default" : "outline"} 
            size="sm" 
            className="flex gap-2 h-9 text-xs"
          >
            <Sliders className="h-4 w-4" />
            <span>{isEditing ? "Finish Editing" : "Edit Matrix Items"}</span>
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

      {/* 📱 MOBILE VIEW: Compact Continuous Spreadsheet Matrix */}
      <div className="block md:hidden space-y-4">
        {grouped.map(({ section, factory, top, rows }) => (
          <div key={section.id} className="border rounded-lg overflow-visible bg-background shadow-sm">
            <table className="w-full border-collapse text-left text-[11px] table-fixed">
              <thead className="bg-slate-50 sticky top-0 z-10 border-b backdrop-blur-md shadow-xs">
                {/* Embedded Section Info Header Row */}
                <tr className="bg-slate-50 font-bold text-slate-800">
                  <td colSpan={7} className="py-2 px-2 text-left rounded-t-lg">
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <div className="text-xs font-bold text-foreground">{section.name}</div>
                          <div className="text-[10px] font-normal text-muted-foreground">
                            {factory?.name}: {factory?.basic_rate ?? 0} + {section.adder} add
                          </div>
                        </div>
                        {/* Interactive Sauda Dropdown Selection for Mobile */}
                        {factory && allOpenSaudas.length > 0 && (
                          <div className="flex items-center gap-1">
                            <Select 
                              value={pickedSauda[factory.id] ?? top?.id ?? ""} 
                              onValueChange={(v) => setPickedSauda((p) => ({ ...p, [factory.id]: v }))}
                            >
                              <SelectTrigger className="h-7 w-40 text-[10px] bg-background px-2 py-0 shadow-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {allOpenSaudas.map((o) => (
                                  <SelectItem key={o.id} value={o.id} className="text-[11px]">
                                    {o.party} (B: {o.basic}) — {o.pending}T
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                      </div>
                      
                      {/* Detailed Metadata Badges with Sauda Basic Rate */}
                      {top && (
                        <div className="text-[10px] text-emerald-800 font-medium bg-emerald-50 border border-emerald-100 rounded-sm px-1.5 py-0.5 w-max flex items-center gap-1.5">
                          <span>Sauda Basic: <strong className="font-bold">₹{top.basic}</strong></span>
                          <span className="text-emerald-300">|</span>
                          <span className="truncate max-w-[100px]">Party: {top.party}</span>
                          <span className="text-emerald-300">|</span>
                          <span>Bal: {top.pending}t</span>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
                {/* Unified 7-Column Layout Header Row */}
                <tr className="text-muted-foreground font-semibold bg-muted/50 border-t">
                  <th className="py-2 px-1 pl-2 w-[24%] text-left">Item</th>
                  <th className="py-2 px-1 text-right w-[11%]">±</th>
                  <th className="py-2 px-1 text-right w-[14%] bg-primary/5 text-primary font-bold">Today</th>
                  <th className="py-2 px-1 text-right w-[13%]">Sauda</th>
                  <th className="py-2 px-1 text-right w-[12%]">Party</th>
                  <th className="py-2 px-1 text-right w-[13%]">Stock</th>
                  <th className="py-2 px-1 text-right pr-2 w-[13%]">Last</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-muted/5">
                    <td className="py-2 px-1 pl-2 font-medium text-foreground break-words">
                      {isEditing ? (
                        <div className="flex flex-col gap-1 pr-1">
                          <Input
                            value={r.name}
                            onChange={(e) => setLocalNames((p) => ({ ...p, [r.id]: e.target.value }))}
                            className="h-7 text-[10px] p-1 bg-background border-primary/30"
                          />
                          <Select value={r.section_id} onValueChange={(val) => setLocalSections((p) => ({ ...p, [r.id]: val }))}>
                            <SelectTrigger className="h-6 text-[9px] bg-background px-1 py-0 border-primary/20">
                              <SelectValue placeholder="Sec" />
                            </SelectTrigger>
                            <SelectContent>
                              {sections.data?.map((s) => (
                                <SelectItem key={s.id} value={s.id} className="text-[11px]">{s.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      ) : (
                        r.name
                      )}
                    </td>
                    <td className="py-2 px-1 text-right font-mono text-muted-foreground whitespace-nowrap">
                      {isEditing ? (
                        <Input
                          type="number"
                          value={r.gauge_diff}
                          onChange={(e) => setLocalGauges((p) => ({ ...p, [r.id]: Number(e.target.value) }))}
                          className="h-7 w-full text-right text-[10px] p-1 bg-background border-primary/30"
                        />
                      ) : (
                        r.gauge_diff > 0 ? `+${r.gauge_diff}` : r.gauge_diff
                      )}
                    </td>
                    <td className="py-2 px-1 text-right font-mono font-bold text-primary bg-primary/[0.01] whitespace-nowrap">{r.today.toFixed(0)}</td>
                    <td className="py-2 px-1 text-right font-mono text-foreground whitespace-nowrap">{r.sauda === null ? "—" : r.sauda.toFixed(0)}</td>
                    <td className="py-2 px-1 text-right font-mono text-foreground whitespace-nowrap">{r.party.toFixed(0)}</td>
                    <td className="py-2 px-1 text-right font-mono font-semibold text-foreground whitespace-nowrap">{Number(r.available_qty).toFixed(1)}t</td>
                    <td className="py-2 px-1 text-right pr-2 font-mono text-muted-foreground whitespace-nowrap">{r.last_purchase_rate ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      {/* 💻 WEB VIEW: Spacious, High-Information Card System */}
      <div className="hidden md:block space-y-4">
        {grouped.map(({ section, factory, top, rows }) => (
          <Card key={section.id} id={`section-${section.id}`} className="scroll-mt-20 overflow-visible">
            <div className="sticky top-14 z-20 bg-card border-b shadow-xs rounded-t-lg">
              <div className="p-4 pb-2 flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                  {section.name}
                  <span className="text-xs font-normal text-muted-foreground flex items-center gap-1">
                    (<Factory className="h-3 w-3 inline" /> {factory?.name} {factory?.basic_rate ?? 0} + {section.adder} adder)
                  </span>
                </h3>
                {factory && allOpenSaudas.length > 0 && (
                  <div className="flex items-center gap-2 text-xs font-normal">
                    <span className="text-muted-foreground">Selected Sauda:</span>
                    <Select value={pickedSauda[factory.id] ?? top?.id ?? ""} onValueChange={(v) => setPickedSauda((p) => ({ ...p, [factory.id]: v }))}>
                      <SelectTrigger className="h-7 w-72 text-xs bg-background"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {allOpenSaudas.map((o) => (
                          <SelectItem key={o.id} value={o.id} className="text-xs">{o.party} — basic {o.basic} ({o.pending} pending)</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
              
              {/* Header Titles */}
              <div className="px-4 py-2 flex text-xs font-semibold text-muted-foreground bg-muted/20 border-t">
                <div className="w-[24%] text-left">Item Name & Section Allocation</div>
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
                {rows.map((r) => (
                  <div key={r.id} className="flex px-4 py-2.5 items-center hover:bg-muted/10 transition-colors">
                    
                    {/* Item Name & Section Dropdown Column */}
                    <div className="w-[24%] text-left font-medium pr-2 text-slate-900">
                      {isEditing ? (
                        <div className="flex flex-col gap-1.5 max-w-[90%]">
                          <Input
                            value={r.name}
                            onChange={(e) => setLocalNames((p) => ({ ...p, [r.id]: e.target.value }))}
                            className="h-7 text-xs bg-background border-primary/40 focus-visible:ring-primary font-medium"
                          />
                          <Select value={r.section_id} onValueChange={(val) => setLocalSections((p) => ({ ...p, [r.id]: val }))}>
                            <SelectTrigger className="h-6 text-[11px] bg-background py-0 border-primary/20">
                              <SelectValue placeholder="Section Placement" />
                            </SelectTrigger>
                            <SelectContent>
                              {sections.data?.map((s) => (
                                <SelectItem key={s.id} value={s.id} className="text-xs">{s.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      ) : (
                        r.name
                      )}
                    </div>
                    
                    {/* Gauge Column */}
                    <div className="w-[10%] text-right text-muted-foreground font-mono pr-2 flex justify-end items-center">
                      {isEditing ? (
                        <Input
                          type="number"
                          value={r.gauge_diff}
                          onChange={(e) => setLocalGauges((p) => ({ ...p, [r.id]: Number(e.target.value) }))}
                          className="h-7 w-16 text-right text-xs p-1 bg-background border-primary/40 focus-visible:ring-primary font-mono font-medium"
                        />
                      ) : (
                        r.gauge_diff > 0 ? `+${r.gauge_diff}` : r.gauge_diff
                      )}
                    </div>

                    <div className="w-[13%] text-right font-mono font-bold text-primary">
                      {r.today.toFixed(0)}
                    </div>
                    <div className="w-[13%] text-right font-mono text-slate-700">
                      {r.sauda === null ? "—" : r.sauda.toFixed(0)}
                    </div>
                    <div className="w-[13%] text-right font-mono text-slate-700">
                      {r.party.toFixed(0)}
                    </div>
                    <div className="w-[13%] text-right text-slate-900 font-medium">
                      {Number(r.available_qty).toFixed(2)} MT
                    </div>
                    <div className="w-[14%] text-right text-muted-foreground font-mono pr-1">
                      {r.last_purchase_rate ?? "—"}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Floating Category Navigation Button */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon" className="fixed bottom-6 right-6 h-12 w-12 rounded-full shadow-lg z-50"><List className="h-5 w-5" /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top" className="max-h-80 overflow-y-auto w-60">
          <DropdownMenuLabel className="text-xs">Jump to section</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {grouped.map(({ section, factory }) => (
            <DropdownMenuItem key={section.id} onSelect={() => document.getElementById(`section-${section.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}>
              <div className="flex flex-col text-xs">
                <span className="font-semibold">{section.name}</span>
                <span className="text-[10px] text-muted-foreground">{factory?.name}</span>
              </div>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
