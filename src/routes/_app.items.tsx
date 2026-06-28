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
import { List, Settings2 } from "lucide-react";
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
  // sectionId -> selected sauda id
  const [pickedSauda, setPickedSauda] = useState<Record<string, string>>({});
  const [isEditingGauges, setIsEditingGauges] = useState(false);
  const [tempGauges, setTempGauges] = useState<Record<string, string>>({});

  // 1. Sauda drop down logic: Show all open saudas from all factories/parties
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
      .filter(s => s.pending > 0)
      .sort((a, b) => a.party_name.localeCompare(b.party_name));
  }, [saudas.data]);

  const updateGaugesMut = useMutation({
    mutationFn: async () => {
      for (const [id, val] of Object.entries(tempGauges)) {
        const { error } = await supabase.from("items").update({ gauge_diff: Number(val) }).eq("id", id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Gauge differences updated successfully");
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
      // Calculate Sauda rate using the selected sauda's basic + section adder
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
      {/* Fixed Search and Tool Bar */}
      <div className="sticky top-[56px] z-40 bg-background/95 backdrop-blur py-3 flex items-center justify-between gap-4 border-b px-1">
        <div className="flex-1 max-w-xs">
          <Input placeholder="Search item…" value={q} onChange={(e) => setQ(e.target.value)} className="h-9 shadow-sm" />
        </div>
        <div className="flex gap-2">
          {isEditingGauges ? (
            <>
              <Button variant="ghost" size="sm" onClick={() => { setIsEditingGauges(false); setTempGauges({}); }}>Cancel</Button>
              <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => updateGaugesMut.mutate()} disabled={updateGaugesMut.isPending}>
                {updateGaugesMut.isPending ? "Saving..." : "Save Gauges"}
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
        <Card key={section.id} id={`section-${section.id}`} className="scroll-mt-44 overflow-visible border-none shadow-none sm:border sm:shadow-sm">
          {/* Section Header - Sticky below the search bar */}
          <CardHeader className="sticky top-[113px] z-30 bg-slate-100 border-y py-2 px-4 shadow-sm">
            <CardTitle className="text-sm flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-baseline gap-2">
                <span className="font-black uppercase text-slate-700 tracking-wider">{section.name}</span>
                <span className="text-[10px] font-bold text-muted-foreground bg-white px-2 py-0.5 rounded border">
                  {factory?.name} @ {factory?.basic_rate} (+{section.adder})
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground uppercase font-black text-[9px]">Apply Sauda:</span>
                <Select
                  value={pickedSauda[section.id] || "none"}
                  onValueChange={(v) => setPickedSauda((p) => ({ ...p, [section.id]: v }))}
                >
                  <SelectTrigger className="h-7 w-48 sm:w-80 text-[11px] bg-white font-medium border-slate-300">
                    <SelectValue placeholder="Select any Sauda..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none" className="text-[11px]">-- No Sauda (Show Today's) --</SelectItem>
