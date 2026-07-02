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
import { List, Sliders, FileText, FileDown, Plus, Edit } from "lucide-react";
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
  const [pickedTodayFactory, setPickedTodayFactory] = useState<Record<string, string>>({});
  const [pickedSauda, setPickedSauda] = useState<Record<string, string>>({});
  const [isEditingGauges, setIsEditingGauges] = useState(false);
  const [localGauges, setLocalGauges] = useState<Record<string, number>>({});
  const [pdfCols, setPdfCols] = useState<ColKey[]>(DEFAULT_PDF_COLS);

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

  // --- CRUD Actions ---
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

  const handleSaveSection = (e: React.FormEvent) => {
    e.preventDefault();
    // Connect your mutation engine here (e.g., useMutation hook setup)
    console.log("Saving Section data:", sectionForm);
    setIsSectionDialogOpen(false);
  };

  const handleSaveItem = (e: React.FormEvent) => {
    e.preventDefault();
    // Connect your mutation engine here (e.g., useMutation hook setup)
    console.log("Saving Item data:", itemForm);
    setIsItemDialogOpen(false);
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
        <div>
          <h2 className="text-2xl font-bold">Items Matrix</h2>
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <Input placeholder="Search..." value={q} onChange={(e) => setQ(e.target.value)} className="w-32 md:w-48 h-9" />

          {/* Quick Creator Operations Menu */}
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
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-muted/5 group">
                    <td className="py-2 px-1 pl-2 font-medium text-foreground break-words">
                      <div className="flex items-center gap-1">
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
                    <td className="py-2 px-1 text-right pr-2 font-mono text-muted-foreground whitespace-nowrap">{r.last_purchase_rate ?? "—"}</td>
                  </tr>
                ))}
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
                {rows.map((r) => (
                  <div key={r.id} className="flex px-4 py-2.5 items-center hover:bg-muted/10 transition-colors group">
                    <div className="w-[24%] text-left font-medium pr-2 text-slate-900 flex items-center gap-2">
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
                    <div className="w-[14%] text-right text-muted-foreground font-mono pr-1">{r.last_purchase_rate ?? "—"}</div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* --- ADD/EDIT SECTION DIALOG --- */}
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
              <Button type="submit">Save Section</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* --- ADD/EDIT ITEM DIALOG --- */}
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
              <Button type="submit">Save Matrix Item</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* --- JUMP TO SECTION ACTION SHEET BAR --- */}
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
