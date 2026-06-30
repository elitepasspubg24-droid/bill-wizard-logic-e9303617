import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { fetchFactories, fetchSections, fetchItems, fetchSaudas } from "@/lib/queries";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

  return (
    <div className="w-full space-y-3 px-1">
      {/* Dynamic Top Dashboard Strip */}
      <div className="flex items-center justify-between gap-3 border-b pb-2 flex-wrap">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Live Rates Matrix</h2>
        </div>
        
        <div className="flex items-center gap-2 flex-wrap">
          {/* Quick Shifts Panel */}
          <div className="flex items-center gap-1 border rounded-md p-0.5 bg-muted/50 text-xs">
            <span className="px-2 font-medium text-muted-foreground">Shift All:</span>
            <button className="h-6 px-1.5 rounded bg-background border hover:bg-red-50 text-red-600" onClick={() => setRateOffset(p => p - 100)}>-100</button>
            <button className="h-6 px-1.5 rounded bg-background border hover:bg-emerald-50 text-emerald-600" onClick={() => setRateOffset(p => p + 100)}>+100</button>
            {rateOffset !== 0 && (
              <button className="h-6 px-1.5 rounded bg-amber-100 text-amber-800 font-bold flex items-center gap-1" onClick={() => setRateOffset(0)}>
                <RotateCcw className="h-3 w-3" /> Clr ({rateOffset > 0 ? `+${rateOffset}` : rateOffset})
              </button>
            )}
          </div>

          <Input placeholder="Filter item…" value={q} onChange={(e) => setQ(e.target.value)} className="w-40 h-7 text-xs" />
        </div>
      </div>

      {/* Main Dense Spreadsheet Grid */}
      <div className="border rounded-md overflow-hidden bg-background shadow-xs">
        <table className="w-full border-collapse text-left text-xs">
          <thead className="bg-muted/70 sticky top-0 z-30 border-b">
            <tr className="text-muted-foreground font-medium">
              <th className="p-1.5 pl-3 w-[25%]">Item Details</th>
              <th className="p-1.5 text-right w-[10%]">Gauge Diff</th>
              <th className="p-1.5 text-right w-[13%] bg-primary/5 text-primary font-semibold">Today's Rate</th>
              <th className="p-1.5 text-right w-[13%]">Sauda Rate</th>
              <th className="p-1.5 text-right w-[13%]">Party Rate</th>
              <th className="p-1.5 text-right w-[13%]">Available Stock</th>
              <th className="p-1.5 text-right pr-3 w-[13%]">Last Rate</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {grouped.map(({ section, factory, top, rows }) => (
              <useMemo key={section.id} rows={rows}>
                {/* Section Context Header Strip */}
                <tr className="bg-muted/30 font-medium group text-slate-700" id={`sec-${section.id}`}>
                  <td colSpan={7} className="p-1.5 pl-3 border-y bg-slate-50/70">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-foreground text-sm">{section.name}</span>
                        <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                          (<Factory className="h-3 w-3 inline" /> {factory?.name}: {((factory?.basic_rate ?? 0) + rateOffset)} + {section.adder} adder)
                        </span>
                      </div>
                      
                      {/* Integrated Sauda Selector Dropdown inside row divider */}
                      {factory && allOpenSaudas.length > 0 && (
                        <div className="flex items-center gap-1.5 text-[11px]" onClick={(e) => e.stopPropagation()}>
                          <span className="text-muted-foreground font-normal">Active Sauda:</span>
                          <Select value={pickedSauda[factory.id] ?? top?.id ?? ""} onValueChange={(v) => setPickedSauda((p) => ({ ...p, [factory.id]: v }))}>
                            <SelectTrigger className="h-5 w-56 text-[11px] px-1.5 py-0 bg-background"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {allOpenSaudas.map((o) => (
                                <SelectItem key={o.id} value={o.id} className="text-[11px]">{o.party} — b:{o.basic} ({o.pending}T rem)</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>

                {/* Dense Item Rows */}
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/60 transition-colors group">
                    <td className="p-1.5 pl-3 font-medium text-slate-900">{r.name}</td>
                    <td className="p-1.5 text-right text-muted-foreground font-mono">{r.gauge_diff > 0 ? `+${r.gauge_diff}` : r.gauge_diff}</td>
                    <td className="p-1.5 text-right font-mono font-bold text-primary bg-primary/[0.02]">{r.today.toFixed(0)}</td>
                    <td className="p-1.5 text-right font-mono text-slate-700">{r.sauda === null ? "—" : r.sauda.toFixed(0)}</td>
                    <td className="p-1.5 text-right font-mono text-slate-700">{r.party.toFixed(0)}</td>
                    <td className="p-1.5 text-right font-semibold text-slate-900 font-mono">{Number(r.available_qty).toFixed(1)} <span className="text-[10px] text-muted-foreground font-normal">MT</span></td>
                    <td className="p-1.5 text-right pr-3 font-mono text-muted-foreground">{r.last_purchase_rate ?? "—"}</td>
                  </tr>
                ))}
              </useMemo>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
