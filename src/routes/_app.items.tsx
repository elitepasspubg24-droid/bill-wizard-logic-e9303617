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
import { List } from "lucide-react";
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

  const allOpenSaudas = useMemo(() => {
    if (!saudas.data) return [];
    return (saudas.data as any[])
      .filter((s) => s.status !== "done")
      .map((s) => {
        const itemsTotal = (s.sauda_items ?? []).reduce((a: number, r: any) => a + Number(r.qty || 0), 0);
        const total = Number(s.total_qty || 0) || itemsTotal;
        const pending = Math.max(0, total - Number(s.lifted_qty || 0));
        return { ...s, pending };
      })
      .filter(s => s.pending > 0);
  }, [saudas.data]);

  const updateGaugesMut = useMutation({
    mutationFn: async () => {
      for (const [id, val] of Object.entries(tempGauges)) {
        const { error } = await supabase.from("items").update({ gauge_diff: Number(val) }).eq("id", id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Gauges updated");
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
      {/* Fixed Tool Bar */}
      <div className="sticky top-[56px] z-40 bg-background/95 backdrop-blur py-3 flex items-center justify-between gap-4 border-b px-1">
        <div className="flex-1 max-w-xs">
          <Input placeholder="Search item…" value={q} onChange={(e) => setQ(e.target.value)} className="h-9" />
        </div>
        <div className="flex gap-2">
          {isEditingGauges ? (
            <>
              <Button variant="outline" size="sm" onClick={() => { setIsEditingGauges(false); setTempGauges({}); }}>Cancel</Button>
              <Button size="sm" onClick={() => updateGaugesMut.mutate()} disabled={updateGaugesMut.isPending}>
                {updateGaugesMut.isPending ? "Saving..." : "Save Gauges"}
              </Button>
            </>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setIsEditingGauges(true)}>Edit Gauges</Button>
          )}
        </div>
      </div>

      {grouped.map(({ section, factory, top, rows }) => (
        <Card key={section.id} id={`section-${section.id}`} className="scroll-mt-48 border-none shadow-none sm:border sm:shadow-sm">
          {/* Section Header - Sticky below toolbar */}
          <CardHeader className="sticky top-[113px] z-30 bg-card border-y py-3 px-4">
            <CardTitle className="text-base flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-baseline gap-2">
                <span className="font-bold uppercase tracking-tight">{section.name}</span>
                <span className="text-[11px] font-normal text-muted-foreground hidden sm:inline">
                  ({factory?.name} @ {factory?.basic_rate})
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground uppercase font-bold text-[10px]">Sauda Picker:</span>
                <Select
                  value={pickedSauda[section.id] || "none"}
                  onValueChange={(v) => setPickedSauda((p) => ({ ...p, [section.id]: v }))}
                >
                  <SelectTrigger className="h-8 w-48 sm:w-64 text-xs bg-background"><SelectValue placeholder="Choose Sauda..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">-- No Sauda (Show Today's) --</SelectItem>
                    {allOpenSaudas.map((o) => (
                      <SelectItem key={o.id} value={o.id} className="text-xs">
                        {o.party_name} ({o.sauda_basic})
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
                <thead className="sticky top-[168px] z-20 bg-slate-50 border-b">
                  <tr className="text-left text-muted-foreground font-bold text-[10px] uppercase">
                    <th className="p-3">Item Name</th>
                    <th className="p-3 text-right">Gauge Diff</th>
                    <th className="p-3 text-right text-blue-700">Today Rate</th>
                    <th className="p-3 text-right text-orange-700">Sauda Rate</th>
                    <th className="p-3 text-right">Party Rate</th>
                    <th className="p-3 text-right">Stock Qty</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((r) => (
                    <tr key={r.id} className="hover:bg-muted/30 transition-colors">
                      <td className="p-3 font-semibold text-slate-900">{r.name}</td>
                      <td className="p-3 text-right">
                        {isEditingGauges ? (
                          <Input 
                            className="h-7 w-20 ml-auto text-right text-xs" 
                            type="number" 
                            defaultValue={r.gauge_diff}
                            onChange={(e) => setTempGauges({ ...tempGauges, [r.id]: e.target.value })} 
                          />
                        ) : (
                          <span className="text-muted-foreground font-mono">{r.gauge_diff > 0 ? `+${r.gauge_diff}` : r.gauge_diff}</span>
                        )}
                      </td>
                      <td className="p-3 text-right font-mono font-bold text-blue-600">{r.today.toFixed(0)}</td>
                      <td className="p-3 text-right font-mono font-bold text-orange-600">
                        {r.sauda === null ? "—" : r.sauda.toFixed(0)}
                      </td>
                      <td className="p-3 text-right font-mono text-slate-600">{r.party.toFixed(0)}</td>
                      <td className="p-3 text-right tabular-nums font-medium">
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

      {/* Floating Jump Button */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon" className="fixed bottom-6 right-6 h-14 w-14 rounded-full shadow-2xl z-50"><List className="h-6 w-6" /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top" className="max-h-96 overflow-y-auto w-64">
          <DropdownMenuLabel>Jump to Section</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {grouped.map(({ section }) => (
            <DropdownMenuItem key={section.id} onSelect={() => document.getElementById(`section-${section.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}>
              {section.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
