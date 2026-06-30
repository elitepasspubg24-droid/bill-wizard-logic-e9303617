import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { fetchFactories, fetchSections, fetchItems, fetchSaudas } from "@/lib/queries";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RotateCcw } from "lucide-react";

export const Route = createFileRoute("/_app/items")({
  component: ItemsPage,
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
    <div className="w-full">
      {/* Tight Header */}
      <div className="flex items-center justify-between p-2 border-b">
        <h2 className="text-sm font-bold">Matrix</h2>
        <div className="flex gap-1">
           <Input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} className="w-24 h-7 text-[10px]" />
           <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setRateOffset(0)}><RotateCcw className="h-3 w-3"/></Button>
        </div>
      </div>

      {/* 📱 MOBILE VIEW: Tight Table */}
      <div className="block md:hidden">
        <table className="w-full table-fixed text-[9px] border-collapse">
          <thead className="bg-slate-100 text-[8px] uppercase">
            <tr>
              <th className="p-0.5 text-left truncate">Item</th>
              <th className="p-0.5 text-right w-6">G</th>
              <th className="p-0.5 text-right w-8">Tod</th>
              <th className="p-0.5 text-right w-8">Sau</th>
              <th className="p-0.5 text-right w-8">Pty</th>
              <th className="p-0.5 text-right w-8">Stk</th>
              <th className="p-0.5 text-right w-8">Lst</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {grouped.map(({ section, factory, top, rows }) => (
              <>
                <tr className="bg-slate-50">
                  <td colSpan={7} className="p-1">
                    <div className="font-bold text-[9px] truncate">{section.name}</div>
                    {factory && (
                      <Select value={pickedSauda[factory.id] ?? top?.id ?? ""} onValueChange={(v) => setPickedSauda((p) => ({ ...p, [factory.id]: v }))}>
                        <SelectTrigger className="h-5 text-[9px] w-full px-1 border border-slate-200">
                          <SelectValue placeholder="Sauda" />
                        </SelectTrigger>
                        <SelectContent className="text-[10px]">
                          {allOpenSaudas.map((o) => (
                            <SelectItem key={o.id} value={o.id}>{o.party} ({o.basic})</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </td>
                </tr>
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="p-0.5 truncate leading-tight font-medium">{r.name}</td>
                    <td className="p-0.5 text-right font-mono">{r.gauge_diff}</td>
                    <td className="p-0.5 text-right font-mono font-bold text-primary">{r.today.toFixed(0)}</td>
                    <td className="p-0.5 text-right font-mono">{r.sauda ? r.sauda.toFixed(0) : "-"}</td>
                    <td className="p-0.5 text-right font-mono">{r.party.toFixed(0)}</td>
                    <td className="p-0.5 text-right font-mono">{Number(r.available_qty).toFixed(0)}</td>
                    <td className="p-0.5 text-right font-mono">{r.last_purchase_rate ?? "-"}</td>
                  </tr>
                ))}
              </>
            ))}
          </tbody>
        </table>
      </div>

      {/* 💻 WEB VIEW */}
      <div className="hidden md:block p-4 space-y-2">
         {grouped.map(({ section, rows }) => (
          <Card key={section.id} className="overflow-hidden">
             <div className="bg-muted p-2 font-bold text-xs border-b">{section.name}</div>
             <div className="grid grid-cols-7 text-[10px] font-semibold p-1 bg-slate-50 border-b text-right">
                <div className="text-left col-span-1">Item</div>
                <div>Gauge</div><div>Today</div><div>Sauda</div><div>Party</div><div>Stock</div><div>Last</div>
             </div>
             {rows.map((r) => (
                <div key={r.id} className="grid grid-cols-7 p-1 text-[11px] border-b hover:bg-slate-50 text-right">
                  <div className="text-left col-span-1 truncate">{r.name}</div>
                  <div>{r.gauge_diff}</div>
                  <div className="font-bold text-primary">{r.today.toFixed(0)}</div>
                  <div>{r.sauda?.toFixed(0) ?? "-"}</div>
                  <div>{r.party.toFixed(0)}</div>
                  <div>{Number(r.available_qty).toFixed(1)}</div>
                  <div>{r.last_purchase_rate ?? "-"}</div>
                </div>
             ))}
          </Card>
         ))}
      </div>
    </div>
  );
}
