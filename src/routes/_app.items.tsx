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
import { List, FileDown, RotateCcw, Factory } from "lucide-react";

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
  const [rateOffset, setRateOffset] = useState<number>(0);

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
      const baseToday = (f?.basic_rate ?? 0) + Number(s.adder) + rateOffset;
      const top = chosenByFactory.get(s.factory_id);
      const baseSauda = top ? top.basic + Number(s.adder) : null;
      const baseParty = Number(s.party_basic);
      const rows = items
        .data!.filter((i) => i.section_id === s.id)
        .filter((i) => !q || i.name.toLowerCase().includes(q.toLowerCase()))
        .map((i) => ({
          ...i,
          today: baseToday + Number(i.gauge_diff),
          sauda: baseSauda === null ? null : baseSauda + Number(i.gauge_diff),
          party: baseParty + Number(i.gauge_diff),
        }));
      return { section: s, factory: f, top, rows };
    }).filter((g) => g.rows.length > 0);
  }, [factories.data, sections.data, items.data, chosenByFactory, q, rateOffset]);

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
            Live calculations incorporating baseline offsets, section adders, and gauge variations.
          </p>
        </div>
        
        <div className="flex items-center gap-2 flex-wrap">
          {/* Quick Rate Adjuster Control Box */}
          <div className="flex items-center gap-1 border rounded-lg p-1 bg-muted/40 text-xs">
            <span className="px-1.5 font-semibold text-muted-foreground">Shift Baseline:</span>
            <button className="h-7 px-2 rounded bg-background border border-red-200 text-red-600 hover:bg-red-50 text-xs font-medium" onClick={() => setRateOffset(p => p - 100)}>-100</button>
            <button className="h-7 px-2 rounded bg-background border border-emerald-200 text-emerald-600 hover:bg-emerald-50 text-xs font-medium" onClick={() => setRateOffset(p => p + 100)}>+100</button>
            {rateOffset !== 0 && (
              <button className="h-7 px-2 rounded bg-amber-50 border border-amber-200 text-amber-700 font-bold flex items-center gap-1" onClick={() => setRateOffset(0)}>
                <RotateCcw className="h-3 w-3" /> Clr ({rateOffset > 0 ? `+${rateOffset}` : rateOffset})
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Input placeholder="Search item…" value={q} onChange={(e) => setQ(e.target.value)} className="w-36 md:w-48 h-9 text-sm" />
            <Button onClick={handleExportCSV} variant="outline" size="sm" className="gap-2 h-9 text-xs">
              <FileDown className="h-4 w-4" />
              <span className="hidden sm:inline">Export</span>
            </Button>
          </div>
        </div>
      </div>
      
{/* 📱 MOBILE VIEW: Compact Continuous Spreadsheet Matrix */}
<div className="block md:hidden border rounded-lg overflow-x-auto bg-background shadow-sm">
  <table className="border-collapse text-left text-[11px]">
    <thead className="bg-muted/70 sticky top-0 z-10 border-b">
      <tr className="text-muted-foreground font-semibold">
  <th className="p-2 pl-3 w-25">Item Name</th>
  <th className="p-2 text-right w-8">Gauge</th>
  <th className="p-2 text-right w-11 bg-primary/5 text-primary font-bold">Today</th>
  <th className="p-2 text-right w-11">Sauda</th>
  <th className="p-2 text-right w-11">Party</th>
  <th className="p-2 text-right w-8">Stock</th>
  <th className="p-2 text-right pr-3 w-12">Last</th>
</tr>
    </thead>
    <tbody className="divide-y">
      {grouped.map(({ section, factory, top, rows }) => (
        <tr key={section.id} className="contents">
          {/* Embedded Section Info Header Row */}
          <tr className="bg-slate-50 font-bold border-y text-slate-800">
            <td colSpan={7} className="p-2 pl-3">
              <div className="flex flex-col gap-1">
                <div className="text-xs font-bold text-foreground">{section.name}</div>
                <div className="text-[10px] font-normal text-muted-foreground flex items-center gap-1 flex-wrap">
                  <span>({factory?.name}: {(factory?.basic_rate ?? 0) + rateOffset} + {section.adder} add)</span>
                  {top && <span className="text-emerald-700 font-medium">· Sauda: {top.party} ({top.pending}T)</span>}
                </div>
              </div>
            </td>
          </tr>
          {/* Core Mobile Data Rows */}
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-muted/5">
              <td className="p-2 pl-3 font-medium text-foreground break-words">{r.name}</td>
              <td className="p-2 text-right font-mono text-muted-foreground">{r.gauge_diff > 0 ? `+${r.gauge_diff}` : r.gauge_diff}</td>
              <td className="p-2 text-right font-mono font-bold text-primary bg-primary/[0.01]">{r.today.toFixed(0)}</td>
              <td className="p-2 text-right font-mono text-foreground">{r.sauda === null ? "—" : r.sauda.toFixed(0)}</td>
              <td className="p-2 text-right font-mono text-foreground">{r.party.toFixed(0)}</td>
              <td className="p-2 text-right font-mono font-semibold text-foreground">{Number(r.available_qty).toFixed(1)}t</td>
              <td className="p-2 text-right pr-3 font-mono text-muted-foreground">{r.last_purchase_rate ?? "—"}</td>
            </tr>
          ))}
        </tr>
      ))}
    </tbody>
  </table>
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
                    (<Factory className="h-3 w-3 inline" /> {factory?.name} {((factory?.basic_rate ?? 0) + rateOffset)} + {section.adder} adder)
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
                <div className="w-[10%] text-right">Gauge Diff</div>
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
                    <div className="w-[10%] text-right text-muted-foreground font-mono">{r.gauge_diff > 0 ? `+${r.gauge_diff}` : r.gauge_diff}</div>
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
