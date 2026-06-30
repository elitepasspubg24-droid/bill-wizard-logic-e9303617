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
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

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
  // factoryId -> selected sauda id ("" = default top-pending)
  const [pickedSauda, setPickedSauda] = useState<Record<string, string>>({});

  // All open saudas with pending qty across ALL factories
  const allOpenSaudas = useMemo(() => {
    const list: any[] = [];
    if (!saudas.data) return list;
    
    for (const s of saudas.data as any[]) {
      if (!s.factory_id || s.status === "done") continue;
      const itemsTotal = (s.sauda_items ?? []).reduce((a: number, r: any) => a + Number(r.qty || 0), 0);
      const total = Number(s.total_qty || 0) || itemsTotal;
      const pending = Math.max(0, total - Number(s.lifted_qty || 0));
      if (pending <= 0) continue;
      
      list.push({ 
        id: s.id, 
        basic: Number(s.sauda_basic), 
        party: s.party_name, 
        pending,
        factory_id: s.factory_id 
      });
    }
    // sort overall by pending desc
    return list.sort((a, b) => b.pending - a.pending);
  }, [saudas.data]);

  const chosenByFactory = useMemo(() => {
    const map = new Map<string, { basic: number; party: string; pending: number; id: string; factory_id: string }>();
    if (!factories.data) return map;
    
    for (const f of factories.data) {
      const pickId = pickedSauda[f.id];
      // Default to this factory's own top pending, if none exists, fallback to overall top pending
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
      const baseParty = Number(s.party_basic); // party_basic already = todayBasic + adder + party_adder
      
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

  const handleExportPDF = () => {
    const doc = new jsPDF();
    const today = new Date().toLocaleDateString();
    
    doc.setFontSize(14);
    doc.text(`Stock & Purchase Rate Report - ${today}`, 14, 15);
    
    let startY = 25;
    
    grouped.forEach(({ section, factory, rows }) => {
      if (rows.length === 0) return;
      
      // Add section header
      doc.setFontSize(11);
      doc.text(`${section.name} (${factory?.name ?? "Unknown"})`, 14, startY);
      
      // Generate the 3-column table
      autoTable(doc, {
        startY: startY + 4,
        head: [['Item', 'Stock Qty', 'Last Purchase Rate']],
        body: rows.map(r => [
          r.name,
          Number(r.available_qty).toFixed(2),
          r.last_purchase_rate ?? "—"
        ]),
        theme: 'grid',
        headStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0] },
        styles: { fontSize: 9 },
        margin: { left: 14, right: 14 },
      });
      
      // Update Y position for the next section, adding a little padding
      startY = (doc as any).lastAutoTable.finalY + 12;
    });
    
    doc.save(`Stock_Report_${today.replace(/\//g, "-")}.pdf`);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold">Items</h2>
          <p className="text-sm text-muted-foreground">
