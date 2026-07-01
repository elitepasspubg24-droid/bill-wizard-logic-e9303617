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
import { List, FileDown, Factory, Sliders, FileText } from "lucide-react";
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
  const [isEditingGauges, setIsEditingGauges] = useState(false);
  const [localGauges, setLocalGauges] = useState<Record<string, number>>({});

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
    return sections.data.map((s) => {
      const f = fmap.get(s.factory_id);
      const baseToday = (f?.basic_rate ?? 0) + Number(s.adder);
      const top = chosenByFactory.get(s.factory_id);
      const baseSauda = top ? top.basic + Number(s.adder) : null;
      const baseParty = Number(s.party_basic);
      const rows = items
        .data!.filter((i) => i.section_id === s.id)
        .filter((i) => !q || i.name.toLowerCase().includes(q.toLowerCase()))
        .map((i) => {
          const currentGaugeDiff = localGauges[i.id] !== undefined ? localGauges[i.id] : Number(i.gauge_diff);
          return {
            ...i,
            gauge_diff: currentGaugeDiff,
            today: baseToday + currentGaugeDiff,
            sauda: baseSauda === null ? null : baseSauda + currentGaugeDiff,
            party: baseParty + currentGaugeDiff,
          };
        });
      return { section: s, factory: f, top, rows };
    }).filter((g) => g.rows.length > 0);
  }, [factories.data, sections.data, items.data, chosenByFactory, q, localGauges]);

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
          
          {/* Web-Only Edit Gauges Activation Key */}
          <Button 
            onClick={() => setIsEditingGauges(!isEditingGauges)} 
            variant={isEditingGauges ? "default" : "outline"} 
            size="sm" 
            className="hidden md:flex gap-2 h-9 text-xs"
          >
            <Sliders className="h-4 w-4" />
            <span>{isEditingGauges ? "Finish Editing" : "Edit Gauges"}</span>
          </Button>

          <Button onClick={handleExportCSV} variant="outline" size="sm" className="gap-2 h-9 text-xs">
            <FileDown className="h-4 w-4" />
            <span className="hidden sm:inline">Export</span>
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
                  <th className="py-2 px-1 text-right w-[9%]">±</th>
                  <th className="py-2 px-1 text-right w-[14%] bg-primary/5 text-primary font-bold">Today</th>
                  <th className="py-2 px-1 text-right w-[14%]">Sauda</th>
                  <th className="py-2 px-1 text-right w-[13%]">Party</th>
                  <th className="py-2 px-1 text-right w-[13%]">Stock</th>
                  <th className="py-2 px-1 text-right pr-2 w-[13%]">Last</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-muted/5">
                    <td className="py-2 px-1 pl-2 font-medium text-foreground break-words">{r.name}</td>
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
                  <div key={r.id} className="flex px-4 py-2.5 items-center hover:bg-muted/10 transition-colors">
                    <div className="w-[24%] text-left font-medium pr-2 text-slate-900">{r.name}</div>
                    
                    {/* Gauge Column - Renders clean interactive numeric inputs when edit mode is toggled */}
                    <div className="w-[10%] text-right text-muted-foreground font-mono pr-2 flex justify-end items-center">
                      {isEditingGauges ? (
                        <Input
                          type="number"
                          value={r.gauge_diff}
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            setLocalGauges((p) => ({ ...p, [r.id]: val }));
                          }}
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
