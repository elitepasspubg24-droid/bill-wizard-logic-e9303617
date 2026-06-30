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
      <div className="flex items-center justify-between gap-4 flex-wrap border-b pb-3">
        <div>
          <h2 className="text-xl md:text-2xl font-bold tracking-tight">Items Matrix</h2>
        </div>
        <div className="flex items-center gap-2">
          <Input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} className="w-32 h-8 text-xs" />
          <Button onClick={handleExportCSV} variant="outline" size="sm" className="h-8 text-xs">Export</Button>
        </div>
      </div>

      {/* 📱 MOBILE VIEW: Full Table */}
      <div className="block md:hidden border rounded-lg overflow-hidden bg-background">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[10px] min-w-[650px]">
            <thead className="bg-muted/50 border-b">
              <tr className="text-muted-foreground text-[9px]">
                <th className="p-1.5 pl-2 text-left w-[20%]">Item</th>
                <th className="p-1.5 text-right w-[10%]">G</th>
                <th className="p-1.5 text-right w-[14%] text-primary">Today</th>
                <th className="p-1.5 text-right w-[14%]">Sauda</th>
                <th className="p-1.5 text-right w-[14%]">Party</th>
                <th className="p-1.5 text-right w-[14%]">Stock</th>
                <th className="p-1.5 text-right w-[14%] pr-2">Last</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {grouped.map(({ section, factory, top, rows }) => (
                <tr key={section.id} className="contents">
                  <tr className="bg-slate-50 border-y">
                    <td colSpan={7} className="p-1.5 pl-2">
                      <div className="font-bold text-[11px]">{section.name}</div>
                      {factory && (
                        <div className="flex items-center gap-2 mt-1">
                          <Select value={pickedSauda[factory.id] ?? top?.id ?? ""} onValueChange={(v) => setPickedSauda((p) => ({ ...p, [factory.id]: v }))}>
                            <SelectTrigger className="h-6 text-[10px] w-full px-1 bg-white border border-slate-200">
                              <SelectValue placeholder="Select Sauda" />
                            </SelectTrigger>
                            <SelectContent>
                              {allOpenSaudas.map((o) => (
                                <SelectItem key={o.id} value={o.id} className="text-[10px]">
                                  {o.party} - B:{o.basic} ({o.pending}T)
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </td>
                  </tr>
                  {rows.map((r) => (
                    <tr key={r.id} className="hover:bg-muted/20">
                      <td className="p-1.5 pl-2 text-xs font-medium leading-tight whitespace-normal break-words">{r.name}</td>
                      <td className="p-1.5 text-right font-mono">{r.gauge_diff}</td>
                      <td className="p-1.5 text-right font-mono font-bold text-primary">{r.today.toFixed(0)}</td>
                      <td className="p-1.5 text-right font-mono">{r.sauda?.toFixed(0) ?? "-"}</td>
                      <td className="p-1.5 text-right font-mono">{r.party.toFixed(0)}</td>
                      <td className="p-1.5 text-right font-mono">{Number(r.available_qty).toFixed(1)}</td>
                      <td className="p-1.5 text-right font-mono pr-2">{r.last_purchase_rate ?? "-"}</td>
                    </tr>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 💻 WEB VIEW */}
      <div className="hidden md:block space-y-4">
        {grouped.map(({ section, rows }) => (
          <Card key={section.id} className="overflow-hidden">
            <div className="bg-muted/20 p-3 font-bold border-b">{section.name}</div>
            <div className="grid grid-cols-7 text-xs font-semibold p-2 border-b text-muted-foreground text-right">
              <div className="text-left col-span-1">Item</div>
              <div>Gauge</div>
              <div>Today</div>
              <div>Sauda</div>
              <div>Party</div>
              <div>Stock</div>
              <div>Last</div>
            </div>
            {rows.map((r) => (
              <div key={r.id} className="grid grid-cols-7 p-2 text-sm border-b hover:bg-muted/10 text-right">
                <div className="text-left col-span-1 font-medium truncate">{r.name}</div>
                <div className="font-mono">{r.gauge_diff}</div>
                <div className="font-mono font-bold text-primary">{r.today.toFixed(0)}</div>
                <div className="font-mono">{r.sauda?.toFixed(0) ?? "-"}</div>
                <div className="font-mono">{r.party.toFixed(0)}</div>
                <div className="font-mono">{Number(r.available_qty).toFixed(2)}</div>
                <div className="font-mono">{r.last_purchase_rate ?? "-"}</div>
              </div>
            ))}
          </Card>
        ))}
      </div>
    </div>
  );
}
