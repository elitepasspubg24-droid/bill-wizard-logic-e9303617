"import { createFileRoute } from \"@tanstack/react-router\";
import { useQuery, useQueryClient } from \"@tanstack/react-query\";
import { useMemo, useState } from \"react\";
import { toast } from \"sonner\";
import { supabase } from \"@/integrations/supabase/client\";
import { fetchFactories, fetchSections, fetchItems, fetchSaudas, fetchAppSettings } from \"@/lib/queries\";
import { Card, CardContent } from \"@/components/ui/card\";
import { Input } from \"@/components/ui/input\";
import { Button } from \"@/components/ui/button\";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from \"@/components/ui/select\";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from \"@/components/ui/dropdown-menu\";
import { List, Sliders, FileText, FileDown, Plus, Edit } from \"lucide-react\";
import { Popover, PopoverContent, PopoverTrigger } from \"@/components/ui/popover\";
import { Checkbox } from \"@/components/ui/checkbox\";
import { Label } from \"@/components/ui/label\";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from \"@/components/ui/dialog\";
import jsPDF from \"jspdf\";
import autoTable from \"jspdf-autotable\";

/** Resolve a W string (\"10%\" / \"11\" / \"\") against a base. */
function resolveW(input: string | number | undefined | null, base: number): number {
  if (input === null || input === undefined) return 0;
  const raw = String(input).trim();
  if (raw === \"\") return 0;
  if (raw.endsWith(\"%\")) {
    const pct = Number(raw.slice(0, -1).trim());
    if (isNaN(pct)) return 0;
    return (Number(base) || 0) * (pct / 100);
  }
  const n = Number(raw);
  return isNaN(n) ? 0 : n;
}

type ColKey = \"gauge_diff\" | \"today\" | \"sauda\" | \"party\" | \"available_qty\" | \"last_purchase_rate\";
const ALL_COLS: { key: ColKey; label: string }[] = [
  { key: \"gauge_diff\", label: \"Gauge Diff\" },
  { key: \"today\", label: \"Today Rate\" },
  { key: \"sauda\", label: \"Sauda Rate\" },
  { key: \"party\", label: \"Party Rate\" },
  { key: \"available_qty\", label: \"Stock Qty\" },
  { key: \"last_purchase_rate\", label: \"Last Purchase\" },
];
const DEFAULT_PDF_COLS: ColKey[] = [\"available_qty\", \"last_purchase_rate\"];

export const Route = createFileRoute(\"/_app/items\")({
  component: ItemsPage,
  head: () => ({ meta: [{ title: \"Items Summary\" }] }),
});

function ItemsPage() {
  const factories = useQuery({ queryKey: [\"factories\"], queryFn: fetchFactories });
  const sections = useQuery({ queryKey: [\"sections\"], queryFn: fetchSections });
  const items = useQuery({ queryKey: [\"items\"], queryFn: fetchItems });
  const saudas = useQuery({ queryKey: [\"saudas\"], queryFn: fetchSaudas });
  const settings = useQuery({ queryKey: [\"app_settings\"], queryFn: fetchAppSettings });
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);

  const wEnabled = settings.data?.w_enabled ?? true;

  const [q, setQ] = useState(\"\");
  const [pickedTodayFactory, setPickedTodayFactory] = useState<Record<string, string>>({});
  const [pickedSauda, setPickedSauda] = useState<Record<string, string>>({});
  const [isEditingGauges, setIsEditingGauges] = useState(false);
  const [localGauges, setLocalGauges] = useState<Record<string, number>>({});
  const [pdfCols, setPdfCols] = useState<ColKey[]>(DEFAULT_PDF_COLS);

  const [isSectionDialogOpen, setIsSectionDialogOpen] = useState(false);
  const [isItemDialogOpen, setIsItemDialogOpen] = useState(false);

  const [sectionForm, setSectionForm] = useState({ id: \"\", name: \"\", factory_id: \"\" });
  const [itemForm, setItemForm] = useState({
    id: \"\",
    name: \"\",
    section_id: \"\",
    gauge_diff: 0,
    available_qty: 0,
    last_purchase_rate: \"\",
  });

  const allOpenSaudas = useMemo(() => {
    if (!saudas.data) return [];
    return (saudas.data as any[]).filter(s => s.factory_id && s.status !== \"done\").map(s => ({
      id: s.id,
      basic: Number(s.sauda_basic),
      party: s.party_name,
      factory_id: s.factory_id,
      pending: Math.max(
        0,
        (Number(s.total_qty || 0) ||
          (s.sauda_items ?? []).reduce((a: number, r: any) => a + Number(r.qty || 0), 0)) -
          Number(s.lifted_qty || 0)
      ),
    }));
  }, [saudas.data]);

  /** Compute Today's Rate for a factory record, honouring the global W flag. */
  const factoryToday = (fac: any): number => {
    const basic = Number(fac?.basic_rate ?? 0);
    const adder = Number(fac?.adder ?? 0);
    const preW = basic + adder;
    const w = wEnabled ? resolveW(fac?.w_adder, preW) : 0;
    return preW + w;
  };

  const grouped = useMemo(() => {
    if (!sections.data || !items.data || !factories.data) return [];
    const fmap = new Map(factories.data.map((f: any) => [f.id, f]));

    return sections.data
      .map((s: any) => {
        const activeTodayFactoryId = pickedTodayFactory[s.id] ?? s.factory_id;
        const activeTodayFactory: any = fmap.get(activeTodayFactoryId);
        const activeFacBasic = Number(activeTodayFactory?.basic_rate ?? 0);
        const activeFacAdder = Number(activeTodayFactory?.adder ?? 0);
        const preWToday = activeFacBasic + activeFacAdder;
        const activeWAdder = wEnabled ? resolveW(activeTodayFactory?.w_adder, preWToday) : 0;
        const activePartyAdder = Number(activeTodayFactory?.party_adder ?? 0);

        const baseToday = preWToday + activeWAdder;
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
          activeWAdder,
          activePartyAdder,
          topSauda,
          saudaFactory,
          saudaFacAdder,
          rows,
        };
      })
      .filter((g: any) => g.rows.length > 0)
      .sort((a: any, b: any) => {
        const aPipe = a.section.name.trim().toLowerCase().includes(\"ms pipe\");
        const bPipe = b.section.name.trim().toLowerCase().includes(\"ms pipe\");
        if (aPipe && !bPipe) return 1;
        if (!aPipe && bPipe) return -1;
        return 0;
      });
  }, [factories.data, sections.data, items.data, pickedTodayFactory, pickedSauda, allOpenSaudas, q, localGauges, wEnabled]);

  // --- CRUD Actions ---
  const openAddSection = () => {
    setSectionForm({ id: \"\", name: \"\", factory_id: factories.data?.[0]?.id || \"\" });
    setIsSectionDialogOpen(true);
  };
  const openEditSection = (section: any) => {
    setSectionForm({ id: section.id, name: section.name, factory_id: section.factory_id || \"\" });
    setIsSectionDialogOpen(true);
  };
  const openAddItem = (sectionId?: string) => {
    setItemForm({
      id: \"\",
      name: \"\",
      section_id: sectionId || sections.data?.[0]?.id || \"\",
      gauge_diff: 0,
      available_qty: 0,
      last_purchase_rate: \"\",
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
      last_purchase_rate: item.last_purchase_rate != null ? String(item.last_purchase_rate) : \"\",
    });
    setIsItemDialogOpen(true);
  };

  const handleSaveSection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sectionForm.name.trim() || !sectionForm.factory_id) {
      toast.error(\"Section name and factory are required\");
      return;
    }
    setSaving(true);
    try {
      if (sectionForm.id) {
        const { error } = await supabase
          .from(\"sections\")
          .update({ name: sectionForm.name.trim(), factory_id: sectionForm.factory_id })
          .eq(\"id\", sectionForm.id);
        if (error) throw error;
      } else {
        const nextPos = sections.data?.length ?? 0;
        const { error } = await supabase.from(\"sections\").insert({
          name: sectionForm.name.trim(),
          factory_id: sectionForm.factory_id,
          position: nextPos,
        });
        if (error) throw error;
      }
      toast.success(sectionForm.id ? \"Section updated\" : \"Section added\");
      await queryClient.invalidateQueries({ queryKey: [\"sections\"] });
      setIsSectionDialogOpen(false);
    } catch (err: any) {
      toast.error(err.message ?? \"Failed to save section\");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!itemForm.name.trim() || !itemForm.section_id) {
      toast.error(\"Item name and section are required\");
      return;
    }
    setSaving(true);
    try {
      const lastRate =
        itemForm.last_purchase_rate === \"\" ? null : Number(itemForm.last_purchase_rate);
      const payload = {
        name: itemForm.name.trim(),
        section_id: itemForm.section_id,
        gauge_diff: Number(itemForm.gauge_diff) || 0,
        available_qty: Number(itemForm.available_qty) || 0,
        last_purchase_rate: lastRate,
      };
      if (itemForm.id) {
        const { error } = await supabase.from(\"items\").update(payload).eq(\"id\", itemForm.id);
        if (error) throw error;
      } else {
        const nextPos =
          items.data?.filter((i: any) => i.section_id === itemForm.section_id).length ?? 0;
        const { error } = await supabase.from(\"items\").insert({ ...payload, position: nextPos });
        if (error) throw error;
      }
      toast.success(itemForm.id ? \"Item updated\" : \"Item added\");
      await queryClient.invalidateQueries({ queryKey: [\"items\"] });
      setIsItemDialogOpen(false);
    } catch (err: any) {
      toast.error(err.message ?? \"Failed to save item\");
    } finally {
      setSaving(false);
    }
  };

  const handleExportCSV = () => {
    let csvContent = \"data:text/csv;charset=utf-8,\";
    grouped.forEach(({ section, rows }) => {
      csvContent += `SECTION: ${section.name.toUpperCase()}
`;
      csvContent += \"Item,Gauge Diff,Today Rate,Sauda Rate,Party Rate,Stock Qty
\";
      rows.forEach((r: any) => {
        csvContent += `\"${r.name}\",${r.gauge_diff},${r.today},${r.sauda ?? \"—\"},${r.party},${Number(r.available_qty).toFixed(2)}
`;
      });
      csvContent += \"
\";
    });
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement(\"a\");
    link.setAttribute(\"href\", encodedUri);
    link.setAttribute(\"download\", \"Rates_Stock_Report.csv\");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const formatCell = (r: any, key: ColKey): string => {
    switch (key) {
      case \"gauge_diff\": return r.gauge_diff > 0 ? `+${r.gauge_diff}` : String(r.gauge_diff);
      case \"today\": return r.today.toFixed(0);
      case \"sauda\": return r.sauda === null ? \"—\" : r.sauda.toFixed(0);
      case \"party\": return r.party.toFixed(0);
      case \"available_qty\": return `${Number(r.available_qty).toFixed(2)} MT`;
      case \"last_purchase_rate\": return r.last_purchase_rate != null ? String(r.last_purchase_rate) : \"—\";
    }
  };

  const handleExportPDF = () => {
    const doc = new jsPDF({ unit: \"pt\", format: \"a4\" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const selectedCols = ALL_COLS.filter((c) => pdfCols.includes(c.key));
    const head = [[\"Item\", ...selectedCols.map((c) => c.label)]];

    doc.setFontSize(16);
    doc.setFont(\"helvetica\", \"bold\");
    doc.text(\"Items Report\", pageWidth / 2, 40, { align: \"center\" });
    doc.setFontSize(9);
    doc.setFont(\"helvetica\", \"normal\");
    doc.setTextColor(120);
    doc.text(new Date().toLocaleString(), pageWidth / 2, 56, { align: \"center\" });
    doc.setTextColor(0);

    let cursorY = 78;
    grouped.forEach(({ section, rows }, idx) => {
      if (idx > 0) cursorY += 18;
      if (cursorY > doc.internal.pageSize.getHeight() - 80) {
        doc.addPage();
        cursorY = 50;
      }
      doc.setFontSize(12);
      doc.setFont(\"helvetica\", \"bold\");
      doc.text(section.name, 40, cursorY);
      cursorY += 15;

      const body = rows.map((r: any) => [r.name, ...selectedCols.map((c) => formatCell(r, c.key))]);
      autoTable(doc, {
        head,
        body,
        startY: cursorY,
        margin: { left: 40, right: 40 },
        styles: { fontSize: 10, cellPadding: 6, lineColor: [220, 220, 220], lineWidth: 0.5 },
        headStyles: { fillColor: [240, 240, 240], textColor: 30, fontStyle: \"bold\" },
        alternateRowStyles: { fillColor: [250, 250, 250] },
        columnStyles: selectedCols.reduce((acc: any, _c, i) => {
          acc[i + 1] = { halign: \"right\" };
          return acc;
        }, {} as Record<number, any>),
        theme: \"grid\",
      });
      cursorY = (doc as any).lastAutoTable.finalY;
    });

    doc.save(\"Items_Report.pdf\");
  };

  return (
    <div className=\"space-y-4\">
      {/* --- Top Toolbar --- */}
      <div className=\"flex flex-wrap items-center justify-between gap-2\">
        <h2 className=\"text-xl font-semibold\">Items Matrix</h2>
        <div className=\"flex flex-wrap items-center gap-2\">
          <Input
            placeholder=\"Search item…\"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className=\"w-32 md:w-48 h-9\"
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant=\"outline\" size=\"sm\" className=\"h-9 gap-1\">
                <Plus className=\"h-4 w-4\" /> Add New
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align=\"end\">
              <DropdownMenuLabel>Create</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => openAddItem()}>Add Product Item</DropdownMenuItem>
              <DropdownMenuItem onClick={openAddSection}>Add Section Group</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            onClick={() => setIsEditingGauges(!isEditingGauges)}
            variant={isEditingGauges ? \"default\" : \"outline\"}
            size=\"sm\"
            className=\"h-9 hidden md:flex\"
          >
            <Sliders className=\"h-4 w-4 mr-1\" />
            {isEditingGauges ? \"Finish Editing\" : \"Edit Gauges\"}
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant=\"outline\" size=\"sm\" className=\"h-9 gap-1\">
                <FileText className=\"h-4 w-4\" /> PDF
              </Button>
            </PopoverTrigger>
            <PopoverContent className=\"w-72\">
              <div className=\"font-medium text-sm mb-1\">Export as PDF</div>
              <p className=\"text-xs text-muted-foreground mb-2\">Item name is always included.</p>
              <div className=\"grid grid-cols-2 gap-2\">
                {ALL_COLS.map((c) => (
                  <label key={c.key} className=\"flex items-center gap-2 text-sm\">
                    <Checkbox
                      checked={pdfCols.includes(c.key)}
                      onCheckedChange={(v) =>
                        setPdfCols((prev) =>
                          v ? [...prev, c.key] : prev.filter((k) => k !== c.key)
                        )
                      }
                    />
                    {c.label}
                  </label>
                ))}
              </div>
              <Button size=\"sm\" className=\"mt-3 w-full\" onClick={handleExportPDF}>
                Download PDF
              </Button>
            </PopoverContent>
          </Popover>
          <Button variant=\"outline\" size=\"sm\" className=\"h-9 gap-1\" onClick={handleExportCSV}>
            <FileDown className=\"h-4 w-4\" /> CSV
          </Button>
        </div>
      </div>

      {/* --- 📱 MOBILE VIEW --- */}
      <div className=\"md:hidden space-y-4\">
        {grouped.map(({ section, activeTodayFactory, activeFacBasic, activeFacAdder, activeWAdder, rows }) => (
          <Card key={section.id} id={`section-${section.id}`}>
            <CardContent className=\"p-3\">
              <div className=\"flex items-center justify-between mb-2\">
                <div className=\"flex items-center gap-1\">
                  <div className=\"font-semibold text-sm\">{section.name}</div>
                  <button
                    onClick={() => openEditSection(section)}
                    className=\"p-1 text-muted-foreground hover:text-foreground\"
                  >
                    <Edit className=\"h-3 w-3\" />
                  </button>
                </div>
                <div className=\"text-[10px] text-muted-foreground\">
                  Base: {activeFacBasic} + {activeFacAdder}
                  {wEnabled ? ` + ${activeWAdder.toFixed(0)}` : \"\"}
                </div>
              </div>
              <div className=\"flex flex-wrap items-center gap-2 mb-2\">
                <Select
                  value={pickedTodayFactory[section.id] ?? section.factory_id ?? \"\"}
                  onValueChange={(v) => setPickedTodayFactory((p) => ({ ...p, [section.id]: v }))}
                >
                  <SelectTrigger className=\"h-8 text-xs w-full\">
                    <SelectValue placeholder=\"Today's factory\" />
                  </SelectTrigger>
                  <SelectContent>
                    {factories.data?.map((fac: any) => {
                      const today = factoryToday(fac);
                      return (
                        <SelectItem key={fac.id} value={fac.id}>
                          {fac.name} (Today: ₹{today.toFixed(0)})
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                {allOpenSaudas.length > 0 && (
                  <Select
                    value={pickedSauda[section.id] ?? \"\"}
                    onValueChange={(v) => setPickedSauda((p) => ({ ...p, [section.id]: v }))}
                  >
                    <SelectTrigger className=\"h-8 text-xs w-full\">
                      <SelectValue placeholder=\"Sauda\" />
                    </SelectTrigger>
                    <SelectContent>
                      {allOpenSaudas.map((o) => (
                        <SelectItem key={o.id} value={o.id}>
                          {o.party} (Basic: ₹{o.basic}) — {o.pending}T
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <table className=\"w-full text-xs\">
                <thead>
                  <tr className=\"text-left text-muted-foreground\">
                    <th className=\"py-1 pr-1\">Item</th>
                    <th className=\"py-1 pr-1\">±</th>
                    <th className=\"py-1 pr-1\">Today</th>
                    <th className=\"py-1 pr-1\">Sauda</th>
                    <th className=\"py-1 pr-1\">Party</th>
                    <th className=\"py-1 pr-1\">Stock</th>
                    <th className=\"py-1 pr-1\">Last</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r: any) => (
                    <tr key={r.id} className=\"border-t group\">
                      <td className=\"py-1 pr-1 flex items-center gap-1\">
                        {r.name}
                        <button
                          onClick={() => openEditItem(r)}
                          className=\"opacity-40 group-hover:opacity-100 p-0.5 text-muted-foreground hover:text-foreground transition-opacity\"
                        >
                          <Edit className=\"h-3 w-3\" />
                        </button>
                      </td>
                      <td className=\"py-1 pr-1\">
                        {r.gauge_diff > 0 ? `+${r.gauge_diff}` : r.gauge_diff}
                      </td>
                      <td className=\"py-1 pr-1\">{r.today.toFixed(0)}</td>
                      <td className=\"py-1 pr-1\">{r.sauda === null ? \"—\" : r.sauda.toFixed(0)}</td>
                      <td className=\"py-1 pr-1\">{r.party.toFixed(0)}</td>
                      <td className=\"py-1 pr-1\">{Number(r.available_qty).toFixed(1)}t</td>
                      <td className=\"py-1 pr-1\">{r.last_purchase_rate ?? \"—\"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* --- 💻 DESKTOP VIEW --- */}
      <div className=\"hidden md:block space-y-6\">
        {grouped.map(({ section, activeTodayFactory, activeFacBasic, activeFacAdder, activeWAdder, rows }) => (
          <Card key={section.id} id={`section-${section.id}`}>
            <CardContent className=\"p-4\">
              <div className=\"flex items-center justify-between mb-3\">
                <div>
                  <div className=\"flex items-center gap-1\">
                    <h3 className=\"font-semibold\">{section.name}</h3>
                    <Button
                      onClick={() => openEditSection(section)}
                      variant=\"ghost\"
                      size=\"icon\"
                      className=\"h-6 w-6 text-muted-foreground hover:text-foreground\"
                    >
                      <Edit className=\"h-3 w-3\" />
                    </Button>
                  </div>
                  <div className=\"text-xs text-muted-foreground\">
                    ({activeTodayFactory?.name} Basic: ₹{activeFacBasic} + Adder: ₹{activeFacAdder}
                    {wEnabled ? ` + W: ₹${activeWAdder.toFixed(0)}` : \"\"})
                  </div>
                </div>
                <div className=\"flex items-center gap-2\">
                  <div className=\"text-xs text-muted-foreground\">Today's Factory:</div>
                  <Select
                    value={pickedTodayFactory[section.id] ?? section.factory_id ?? \"\"}
                    onValueChange={(v) => setPickedTodayFactory((p) => ({ ...p, [section.id]: v }))}
                  >
                    <SelectTrigger className=\"h-8 text-xs w-64\">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {factories.data?.map((f: any) => {
                        const today = factoryToday(f);
                        return (
                          <SelectItem key={f.id} value={f.id}>
                            {f.name} (Today: ₹{today.toFixed(0)})
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  {allOpenSaudas.length > 0 && (
                    <>
                      <div className=\"text-xs text-muted-foreground\">Selected Sauda:</div>
                      <Select
                        value={pickedSauda[section.id] ?? \"\"}
                        onValueChange={(v) => setPickedSauda((p) => ({ ...p, [section.id]: v }))}
                      >
                        <SelectTrigger className=\"h-8 text-xs w-64\">
                          <SelectValue placeholder=\"—\" />
                        </SelectTrigger>
                        <SelectContent>
                          {allOpenSaudas.map((o) => (
                            <SelectItem key={o.id} value={o.id}>
                              {o.party} (Basic: ₹{o.basic}) — {o.pending}T
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </>
                  )}
                </div>
              </div>

              <table className=\"w-full text-sm\">
                <thead>
                  <tr className=\"text-left text-muted-foreground border-b\">
                    <th className=\"py-2 pr-3\">Item Name</th>
                    <th className=\"py-2 pr-3\">Gauge Diff</th>
                    <th className=\"py-2 pr-3\">Today's Rate</th>
                    <th className=\"py-2 pr-3\">Sauda Rate</th>
                    <th className=\"py-2 pr-3\">Party Rate</th>
                    <th className=\"py-2 pr-3\">Available Qty</th>
                    <th className=\"py-2 pr-3\">Last Purchase</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r: any) => (
                    <tr key={r.id} className=\"border-t group\">
                      <td className=\"py-2 pr-3 flex items-center gap-1\">
                        {r.name}
                        <Button
                          onClick={() => openEditItem(r)}
                          variant=\"ghost\"
                          size=\"icon\"
                          className=\"h-5 w-5 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity\"
                        >
                          <Edit className=\"h-3 w-3\" />
                        </Button>
                      </td>
                      <td className=\"py-2 pr-3\">
                        {isEditingGauges ? (
                          <Input
                            type=\"number\"
                            value={localGauges[r.id] ?? r.gauge_diff}
                            onChange={(e) =>
                              setLocalGauges((p) => ({ ...p, [r.id]: Number(e.target.value) }))
                            }
                            className=\"h-7 w-16 text-right text-xs p-1 bg-background border-primary/40 font-mono font-medium\"
                          />
                        ) : r.gauge_diff > 0 ? (
                          `+${r.gauge_diff}`
                        ) : (
                          r.gauge_diff
                        )}
                      </td>
                      <td className=\"py-2 pr-3\">{r.today.toFixed(0)}</td>
                      <td className=\"py-2 pr-3\">{r.sauda === null ? \"—\" : r.sauda.toFixed(0)}</td>
                      <td className=\"py-2 pr-3\">{r.party.toFixed(0)}</td>
                      <td className=\"py-2 pr-3\">{Number(r.available_qty).toFixed(2)} MT</td>
                      <td className=\"py-2 pr-3\">{r.last_purchase_rate ?? \"—\"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* --- SECTION DIALOG --- */}
      <Dialog open={isSectionDialogOpen} onOpenChange={setIsSectionDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{sectionForm.id ? \"Edit Section Profile\" : \"Create New Section\"}</DialogTitle>
            <DialogDescription>Setup your core category/structural section groups here.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSaveSection} className=\"space-y-3\">
            <div>
              <Label>Section Name</Label>
              <Input
                value={sectionForm.name}
                onChange={(e) => setSectionForm((p) => ({ ...p, name: e.target.value }))}
                placeholder=\"e.g., MS Angle, MS Channel\"
                required
              />
            </div>
            <div>
              <Label>Default Reference Factory</Label>
              <Select
                value={sectionForm.factory_id}
                onValueChange={(v) => setSectionForm((p) => ({ ...p, factory_id: v }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {factories.data?.map((f: any) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type=\"button\" variant=\"outline\" onClick={() => setIsSectionDialogOpen(false)}>
                Cancel
              </Button>
              <Button type=\"submit\" disabled={saving}>
                {saving ? \"Saving...\" : \"Save Section\"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* --- ITEM DIALOG --- */}
      <Dialog open={isItemDialogOpen} onOpenChange={setIsItemDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{itemForm.id ? \"Edit Matrix Item\" : \"Add New Matrix Item\"}</DialogTitle>
            <DialogDescription>
              Configure specific item properties, inventory settings, and structural dimensions.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSaveItem} className=\"space-y-3\">
            <div>
              <Label>Product Item Name / Size</Label>
              <Input
                value={itemForm.name}
                onChange={(e) => setItemForm((p) => ({ ...p, name: e.target.value }))}
                placeholder=\"e.g., 50x50x5mm\"
                required
              />
            </div>
            <div>
              <Label>Belongs to Section Group</Label>
              <Select
                value={itemForm.section_id}
                onValueChange={(v) => setItemForm((p) => ({ ...p, section_id: v }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {sections.data?.map((s: any) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className=\"grid grid-cols-2 gap-3\">
              <div>
                <Label>Gauge Diff (±)</Label>
                <Input
                  type=\"number\"
                  value={itemForm.gauge_diff}
                  onChange={(e) =>
                    setItemForm((p) => ({ ...p, gauge_diff: Number(e.target.value) }))
                  }
                />
              </div>
              <div>
                <Label>Current Stock Qty (MT)</Label>
                <Input
                  type=\"number\"
                  value={itemForm.available_qty}
                  onChange={(e) =>
                    setItemForm((p) => ({ ...p, available_qty: Number(e.target.value) }))
                  }
                />
              </div>
            </div>
            <div>
              <Label>Last Purchase Rate (Optional)</Label>
              <Input
                type=\"number\"
                value={itemForm.last_purchase_rate}
                onChange={(e) =>
                  setItemForm((p) => ({ ...p, last_purchase_rate: e.target.value }))
                }
              />
            </div>
            <DialogFooter>
              <Button type=\"button\" variant=\"outline\" onClick={() => setIsItemDialogOpen(false)}>
                Cancel
              </Button>
              <Button type=\"submit\" disabled={saving}>
                {saving ? \"Saving...\" : \"Save Matrix Item\"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* --- Jump-to-section action bar --- */}
      <div className=\"fixed bottom-2 left-2 right-2 md:hidden\">
        <Card>
          <CardContent className=\"p-2\">
            <div className=\"text-[10px] uppercase tracking-wide text-muted-foreground mb-1 px-1\">
              Jump to Section
            </div>
            <div className=\"flex gap-1 overflow-x-auto no-scrollbar\">
              {grouped.map(({ section }) => (
                <Button
                  key={section.id}
                  size=\"sm\"
                  variant=\"outline\"
                  className=\"h-7 text-xs whitespace-nowrap\"
                  onClick={() => {
                    setTimeout(() => {
                      document
                        .getElementById(`section-${section.id}`)
                        ?.scrollIntoView({ behavior: \"smooth\", block: \"start\" });
                    }, 50);
                  }}
                >
                  <List className=\"h-3 w-3 mr-1\" />
                  {section.name}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
"
