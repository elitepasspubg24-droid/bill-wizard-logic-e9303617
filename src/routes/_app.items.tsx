import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
import { List, Settings2, Check, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/items")({
  component: ItemsPage,
  head: () => ({ meta: [{ title: "Items" }] }),
});

function ItemsPage() {
  const qc = useQueryClient();
  const factories = useQuery({ queryKey: ["factories"], queryFn: fetchFactories });
  const sections = useQuery({ queryKey: ["sections"], queryFn: fetchSections });
  const items = useQuery({ queryKey: ["items"], queryFn: fetchItems });
  const saudas = useQuery({ queryKey: ["saudas"], queryFn: fetchSaudas });
  
  const [q, setQ] = useState("");
  const [pickedSauda, setPickedSauda] = useState<Record<string, string>>({});
  const [isEditingGauges, setIsEditingGauges] = useState(false);
  const [tempGauges, setTempGauges] = useState<Record<string, string>>({});

  // Logic: Show all open saudas from all factories/parties
  const allOpenSaudas = useMemo(() => {
    if (!saudas.data) return [];
    return (saudas.data as any[])
      .filter((s) => s.status !== "done")
      .map((s) => {
        const itemsTotal = (s.sauda_items ?? []).reduce((a: number, r: any) => a + Number(r.qty || 0), 0);
        const total = Number(s.total_qty || 0) || itemsTotal;
        const pending = Math.max(0, total - Number(s.lifted_qty || 0));
        // Include factory name for clarity in global list
        const factoryName = s.factories?.name || "Unknown Factory";
        return { ...s, pending, label: `${s.party_name} (${factoryName})` };
      })
      .filter(s => s.pending > 0)
      .sort((a, b) => a.party_name.localeCompare(b.party_name));
  }, [saudas.data]);

  const updateGaugesMut = useMutation({
    mutationFn: async () => {
      const updates = Object.entries(tempGauges).map(([id, val]) => 
        supabase.from("items").update({ gauge_diff: Number(val) }).eq("id", id)
      );
      const results = await Promise.all(updates);
      const errors = results.filter(r => r.error);
      if (errors.length > 0) throw new Error("Some items failed to update");
    },
    onSuccess: () => {
      toast.success("Gauge differences saved");
      setIsEditingGauges(false);
      setTempGauges({});
      qc.invalidateQueries({ queryKey: ["items"] });
    },
    onError: (e: any) => toast.error(e.message)
  });

  const grouped = useMemo(() => {
    if (!sections.data || !items.data || !factories.data) return [];
    const fmap = new Map(factories.data.map((f) => [f.id, f]));
    const smap = new Map(allOpenSaudas.map((s) => [s.id, s]));

    return sections.data.map((s) => {
      const f = fmap.get(s.factory_id);
      const baseToday = (f?.basic_rate ?? 0) + Number(s.adder);
      
      const selectedSauda = smap.get(pickedSauda[s.id]) || null;
      // Calculate Sauda rate: Sauda Basic + Section Adder + Item Gauge
      const baseSauda = selectedSauda ? Number(selectedSauda.sauda_basic) + Number(s.adder) : null;
      const baseParty = Number(s.party_basic); 

      const rows = items.data!
        .filter((i) => i.section_id === s.id)
        .filter((i) => !q || i.name.toLowerCase().includes(q.toLowerCase()))
        .map((i) => ({
          ...i,
          today: baseToday + Number(i.gauge_diff),
          sauda: baseSauda === null ? null : baseSauda + Number(i.gauge_diff),
          party: baseParty + Number(i.gauge_diff),
        }));
      return { section: s, factory: f, top: selectedSauda, rows };
    }).filter((g) => g.rows.length > 0);
  }, [factories.data, sections.data, items.data, allOpenSaudas, pickedSauda, q]);

  return (
    <div className="space-y-4">
      {/* 1st Sticky Layer: Search & Tools */}
      <div className="sticky top-[56px] z-40 bg-background/95 backdrop-blur py-3 flex items-center justify-between gap-4 border-b px-2">
        <div className="flex-1 max-w-xs">
          <Input 
            placeholder="Search items..." 
            value={q} 
            onChange={(e) => setQ(e.target.value)} 
            className="h-9 shadow-sm" 
          />
        </div>
        <div className="flex gap-2">
          {isEditingGauges ? (
            <>
              <Button variant="ghost" size="sm" onClick={() => { setIsEditingGauges(false); setTempGauges({}); }}>
                <X className="h-4 w-4 mr-1" /> Cancel
              </Button>
              <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => updateGaugesMut.mutate()} disabled={updateGaugesMut.isPending}>
                <Check className="h-4 w-4 mr-1" /> {updateGaugesMut.isPending ? "Saving..." : "Save Gauges"}
              </Button>
            </>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setIsEditingGauges(true)}>
              <Settings2 className="mr-2 h-4 w-4" /> Edit Gauges
            </Button>
          )}
        </div>
      </div>

      {grouped.map(({ section, factory, rows }) => (
        <Card key={section.id} id={`section-${section.id}`} className="scroll-mt-44 border-none shadow-none sm:border sm:shadow-sm overflow-visible">
          {/* 2nd Sticky Layer: Section Name & Global Sauda Picker */}
          <CardHeader className="sticky top-[113px] z-30 bg-slate-100 border-y py-2 px-4 shadow-sm">
            <CardTitle className="text-sm flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-baseline gap-2">
                <span className="font-black uppercase text-slate-700 tracking-wider">{section.name}</span>
                <span className="text-[10px] font-bold text-muted-foreground bg-white px-2 py-0.5 rounded border">
                  Default: {factory?.name} @ {factory?.basic_rate}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground uppercase font-black text-[9px]">Sauda Rate From:</span>
                <Select
                  value={pickedSauda[section.id] || "none"}
                  onValueChange={(v) => setPickedSauda((p) => ({ ...p, [section.id]: v }))}
                >
                  <SelectTrigger className="h-7 w-48 sm:w-80 text-[11px] bg-white font-medium border-slate-300">
                    <SelectValue placeholder="Select any Open Sauda..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none" className="text-[11px]">-- No Sauda (Show Today's Only) --</SelectItem>
                    {allOpenSaudas.map((s) => (
                      <SelectItem key={s.id} value={s.id} className="text-[11px]">
                        {s.label} — Basic: {s.sauda_basic}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardTitle>
          </CardHeader>
          
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                {/* 3rd Sticky Layer: Table Column Headers */}
                <thead className="sticky top-[152px] z-20 bg-slate-50 border-b">
                  <tr className="text-left text-muted-foreground font-bold text-[10px] uppercase">
                    <th className="p-3 w-1/3">Item Name</th>
                    <th className="p-3 text-right">Gauge Diff</th>
                    <th className="p-3 text-right text-blue-700 bg-blue-50/50">Today Rate</th>
                    <th className="p-3 text-right text-orange-700 bg-orange-50/50">Sauda Rate</th>
                    <th className="p-3 text-right">Party Rate</th>
                    <th className="p-3 text-right">Stock</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((r) => (
                    <tr key={r.id} className="hover:bg-muted/30 transition-colors">
                      <td className="p-3 font-bold text-slate-800">{r.name}</td>
                      <td className="p-3 text-right">
                        {isEditingGauges ? (
                          <Input 
                            className="h-7 w-20 ml-auto text-right text-xs font-mono" 
                            type="number" 
                            defaultValue={r.gauge_diff}
                            onChange={(e) => setTempGauges({ ...tempGauges, [r.id]: e.target.value })} 
                          />
                        ) : (
                          <span className="text-muted-foreground font-mono">{r.gauge_diff > 0 ? `+${r.gauge_diff}` : r.gauge_diff}</span>
                        )}
                      </td>
                      <td className="p-3 text-right font-mono font-black text-blue-600 bg-blue-50/20">{r.today.toFixed(0)}</td>
                      <td className="p-3 text-right font-mono font-black text-orange-600 bg-orange-50/20">
                        {r.sauda === null ? "—" : r.sauda.toFixed(0)}
                      </td>
                      <td className="p-3 text-right font-mono text-slate-500">{r.party.toFixed(0)}</td>
                      <td className="p-3 text-right tabular-nums font-semibold text-slate-700">
                        {Number(r.available_qty).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ))}

      {/* Floating Jump Menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon" className="fixed bottom-6 right-6 h-14 w-14 rounded-full shadow-2xl z-50 bg-primary"><List className="h-6 w-6" /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top" className="max-h-96 overflow-y-auto w-64">
          <DropdownMenuLabel>Quick Jump to Category</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {grouped.map(({ section }) => (
            <DropdownMenuItem 
              key={section.id} 
              onSelect={() => {
                const el = document.getElementById(`section-${section.id}`);
                if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
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
