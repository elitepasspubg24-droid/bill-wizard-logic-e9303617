import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { fetchFactories, fetchSections, fetchItems, fetchSaudas } from "@/lib/queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { List, FileDown } from "lucide-react";

export const Route = createFileRoute("/_app/items")({
  component: ItemsPage,
  head: () => ({ meta: [{ title: "Items" }] }),
});

function ItemsPage() {
  const factories = useQuery({ queryKey: ["factories"], queryFn: fetchFactories });
  const sections = useQuery({ queryKey: ["sections"], queryFn: fetchSections });
  const items = useQuery({ queryKey: ["items"], queryFn: fetchItems });
  const saudas = useQuery({ queryKey: ["saudas"], queryFn: fetchSaudas });
  const [q, setQ] = useState("");
  const [pickedSauda, setPickedSauda] = useState<Record<string, string>>({});

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
        .map((i) => ({
          ...i,
          today: baseToday + Number(i.gauge_diff),
          sauda: baseSauda === null ? null : baseSauda + Number(i.gauge_diff),
          party: baseParty + Number(i.gauge_diff),
        }));
      return { section: s, factory: f, top, rows };
    }).filter((g) => g.rows.length > 0);
  }, [factories.data, sections.data, items.data, chosenByFactory, q]);

  const handleExportCSV = () => {
    let csvContent = "data:text/csv;charset=utf-8,";
    
    grouped.forEach(({ section, rows }) => {
      csvContent += `SECTION: ${section.name.toUpperCase()}\r\n`;
      csvContent += "Item,Stock Qty,Last Purchase Rate\r\n";
      
      rows.forEach((r) => {
        const row = [
          `"${r.name}"`, 
          Number(r.available_qty).toFixed(2), 
          `"${r.last_purchase_rate ?? "—"}"`
        ];
        csvContent += row.join(",") + "\r\n";
      });
      
      csvContent += "\r\n\r\n";
    });
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "Stock_Report.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold">Items</h2>
          <p className="text-sm text-muted-foreground">
            Sauda Rate = top-pending sauda basic (per factory) + section adder + gauge diff.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input placeholder="Search item…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
          <Button onClick={handleExportCSV} variant="outline" className="gap-2">
            <FileDown className="h-4 w-4" />
            Export CSV
          </Button>
        </div>
      </div>

      {grouped.map(({ section, factory, top, rows }) => (
        <Card key={section.id} id={`section-${section.id}`} className="scroll-mt-20 overflow-visible">
          {/* Merged Header Component: Stays sticky at the top together */}
          <div className="sticky top-14 z-20 bg-card border-b shadow-sm">
            {/* Section Name & Sauda Dropdown */}
            <div className="p-3 md:p-4 pb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-base font-bold text-foreground">
                {section.name}{" "}
                <span className="text-xs font-normal text-muted-foreground">
                  ({factory?.name} {factory?.basic_rate} + {section.adder} adder
                  {top ? ` · sauda ${top.basic} from ${top.party} (${top.pending} pending)` : " · no pending sauda"})
                </span>
              </h3>
              {factory && allOpenSaudas.length > 0 && (
                <div className="flex items-center gap-2 text-xs font-normal">
                  <span className="text-muted-foreground">Sauda:</span>
                  <Select value={pickedSauda[factory.id] ?? top?.id ?? ""} onValueChange={(v) => setPickedSauda((p) => ({ ...p, [factory.id]: v }))}>
                    <SelectTrigger className="h-7 w-64 md:w-72 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {allOpenSaudas.map((o) => {
                        const fName = factories.data?.find((f) => f.id === o.factory_id)?.name ?? "Unknown";
                        return <SelectItem key={o.id} value={o.id} className="text-xs">{o.party} ({fName}) — basic {o.basic} ({o.pending} pending)</SelectItem>;
                      })}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            
            {/* Table Column Labels Row */}
            <div className="px-3 md:px-4 py-2 flex text-xs font-semibold text-muted-foreground bg-muted/20 border-t">
              <div className="w-[24%] text-left">Item</div>
              <div className="w-[10%] text-right">Gauge Diff</div>
              <div className="w-[13%] text-right">Today's Rate</div>
              <div className="w-[13%] text-right">Sauda Rate</div>
              <div className="w-[13%] text-right">Party Rate</div>
              <div className="w-[13%] text-right">Available Qty</div>
              <div className="w-[14%] text-right">Last Purchase</div>
            </div>
          </div>

          {/* Product Data Rows */}
          <CardContent className="p-0">
            <div className="divide-y text-sm">
              {rows.map((r) => (
                <div key={r.id} className="flex px-3 md:px-4 py-3 items-center hover:bg-muted/10 transition-colors">
                  <div className="w-[24%] text-left font-medium pr-2 break-words">{r.name}</div>
                  <div className="w-[10%] text-right text-muted-foreground">{r.gauge_diff}</div>
                  <div className="w-[13%] text-right font-mono text-foreground">{r.today.toFixed(0)}</div>
                  <div className="w-[13%] text-right font-mono text-foreground">{r.sauda === null ? "—" : r.sauda.toFixed(0)}</div>
                  <div className="w-[13%] text-right font-mono text-foreground">{r.party.toFixed(0)}</div>
                  <div className="w-[13%] text-right text-foreground">{Number(r.available_qty).toFixed(2)}</div>
                  <div className="w-[14%] text-right text-muted-foreground">{r.last_purchase_rate ?? "—"}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon" className="fixed bottom-6 right-6 h-14 w-14 rounded-full shadow-lg z-50"><List className="h-6 w-6" /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top" className="max-h-96 overflow-y-auto w-64">
          <DropdownMenuLabel>Jump to category</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {grouped.map(({ section, factory }) => (
            <DropdownMenuItem key={section.id} onSelect={() => document.getElementById(`section-${section.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}>
              <div className="flex flex-col"><span className="font-medium">{section.name}</span><span className="text-xs text-muted-foreground">{factory?.name}</span></div>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
