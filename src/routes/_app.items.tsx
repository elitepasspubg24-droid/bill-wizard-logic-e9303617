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

  const openSaudasByFactory = useMemo(() => {
    const map = new Map<string, any[]>();
    if (!saudas.data) return map;
    for (const s of saudas.data as any[]) {
      if (!s.factory_id || s.status === "done") continue;
      const itemsTotal = (s.sauda_items ?? []).reduce((a: number, r: any) => a + Number(r.qty || 0), 0);
      const total = Number(s.total_qty || 0) || itemsTotal;
      const pending = Math.max(0, total - Number(s.lifted_qty || 0));
      if (pending <= 0) continue;
      const arr = map.get(s.factory_id) ?? [];
      arr.push({ id: s.id, basic: Number(s.sauda_basic), party: s.party_name, pending });
      map.set(s.factory_id, arr);
    }
    for (const [k, arr] of map) arr.sort((a, b) => b.pending - a.pending);
    return map;
  }, [saudas.data]);

  const chosenByFactory = useMemo(() => {
    const map = new Map<string, { basic: number; party: string; pending: number; id: string }>();
    for (const [fid, list] of openSaudasByFactory) {
      const pickId = pickedSauda[fid];
      const picked = (pickId && list.find((x) => x.id === pickId)) || list[0];
      if (picked) map.set(fid, picked);
    }
    return map;
  }, [openSaudasByFactory, pickedSauda]);

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
        csvContent += `"${r.name}",${Number(r.available_qty).toFixed(2)},"${r.last_purchase_rate ?? "—"}"\r\n`;
      });
      csvContent += "\r\n\r\n";
    });
    const link = document.createElement("a");
    link.setAttribute("href", encodeURI(csvContent));
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
          <p className="text-sm text-muted-foreground">Sauda Rate = top-pending sauda basic (per factory) + section adder + gauge diff.</p>
        </div>
        <div className="flex gap-2">
            <Input placeholder="Search item…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
            <Button onClick={handleExportCSV} variant="outline"><FileDown className="h-4 w-4 mr-2" /> Export CSV</Button>
        </div>
      </div>

      {grouped.map(({ section, factory, top, rows }) => {
        const factoryOpenSaudas = factory ? (openSaudasByFactory.get(factory.id) ?? []) : [];
        return (
          <Card key={section.id} id={`section-${section.id}`} className="scroll-mt-20">
            <CardHeader className="border-b bg-muted/20">
              <CardTitle className="text-base flex flex-wrap items-center justify-between gap-2">
                <span>{section.name} <span className="text-xs font-normal text-muted-foreground">({factory?.name} {factory?.basic_rate} + {section.adder} adder)</span></span>
                {factory && factoryOpenSaudas.length > 0 && (
                  <Select value={pickedSauda[factory.id] ?? factoryOpenSaudas[0].id} onValueChange={(v) => setPickedSauda((p) => ({ ...p, [factory.id]: v }))}>
                    <SelectTrigger className="h-8 w-64 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {factoryOpenSaudas.map((o) => <SelectItem key={o.id} value={o.id} className="text-xs">{o.party} — basic {o.basic}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/50 text-left text-muted-foreground">
                  <tr>
                    <th className="p-3">Item</th>
                    <th className="p-3 text
