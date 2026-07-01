import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { fetchFactories, fetchSections } from "@/lib/queries";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { RotateCcw } from "lucide-react";

export const Route = createFileRoute("/_app/")({
  component: RatesPage,
  head: () => ({ meta: [{ title: "Daily Rates" }] }),
});

function RatesPage() {
  const qc = useQueryClient();
  const factories = useQuery({ queryKey: ["factories"], queryFn: fetchFactories });
  const sections = useQuery({ queryKey: ["sections"], queryFn: fetchSections });

  const [factoryRates, setFactoryRates] = useState<Record<string, string>>({});

  useEffect(() => {
    if (factories.data) {
      const initial: Record<string, string> = {};
      factories.data.forEach((f) => {
        initial[f.id] = String(f.basic_rate || 0);
      });
      setFactoryRates(initial);
    }
  }, [factories.data]);

  const adjustAllRates = (amount: number) => {
    setFactoryRates((prev) => {
      const next = { ...prev };
      (factories.data ?? []).forEach((f) => {
        const currentVal = Number(prev[f.id] || 0);
        next[f.id] = String(currentVal + amount);
      });
      return next;
    });
  };

  const resetAllRates = () => {
    if (factories.data) {
      const initial: Record<string, string> = {};
      factories.data.forEach((f) => {
        initial[f.id] = String(f.basic_rate || 0);
      });
      setFactoryRates(initial);
    }
  };

  const saveAllFactories = useMutation({
    mutationFn: async () => {
      for (const f of factories.data ?? []) {
        const val = Number(factoryRates[f.id]);
        if (isNaN(val)) continue;

        // CRITICAL: Only updating basic_rate, strictly avoiding 'adder'
        const { error } = await supabase
          .from("factories")
          .update({ basic_rate: val, updated_at: new Date().toISOString() })
          .eq("id", f.id);
        
        if (error) throw new Error(`Factory ${f.name} error: ${error.message}`);
      }
    },
    onSuccess: () => {
      toast.success("Factory rates saved successfully");
      qc.invalidateQueries({ queryKey: ["factories"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Daily Factory Rates</h2>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <span>Factory Basic Rates</span>
              <div className="flex items-center gap-1 border rounded-lg p-1 bg-muted/40">
                <button type="button" className="h-7 px-2 text-xs rounded bg-background" onClick={() => adjustAllRates(-100)}>-100</button>
                <button type="button" className="h-7 px-2 text-xs rounded bg-background" onClick={() => adjustAllRates(100)}>+100</button>
                <button type="button" className="h-7 px-2 text-xs rounded" onClick={resetAllRates}><RotateCcw className="h-3 w-3" /></button>
              </div>
            </div>
            <Button size="sm" onClick={() => saveAllFactories.mutate()} disabled={saveAllFactories.isPending}>
              {saveAllFactories.isPending ? "Saving…" : "Save All Factories"}
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {factories.data?.map((f) => (
            <div key={f.id} className="border rounded-md p-3">
              <Label className="text-xs">{f.name}</Label>
              <Input 
                type="number" 
                value={factoryRates[f.id] ?? ""} 
                onChange={(e) => setFactoryRates(prev => ({ ...prev, [f.id]: e.target.value }))} 
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <SectionsCard
        sections={sections.data ?? []}
        factories={factories.data ?? []}
        onSaved={() => qc.invalidateQueries({ queryKey: ["sections"] })}
      />
    </div>
  );
}

function SectionsCard({ sections, factories, onSaved }: { sections: any[]; factories: any[]; onSaved: () => void }) {
  const [rows, setRows] = useState<Record<string, { adder: string; pAdder: string }>>({});

  useEffect(() => {
    const next: Record<string, { adder: string; pAdder: string }> = {};
    sections.forEach(s => {
      next[s.id] = { adder: String(s.adder ?? 0), pAdder: "0" };
    });
    setRows(next);
  }, [sections]);

  const saveAllSections = useMutation({
    mutationFn: async () => {
      for (const s of sections) {
        const r = rows[s.id];
        if (!r) continue;
        const factory = factories.find((f: any) => f.id === s.factory_id);
        const todayBasic = Number(factory?.basic_rate ?? 0);
        
        // This is the ONLY place 'adder' is updated, and it is strictly for the 'sections' table
        const { error } = await supabase
          .from("sections")
          .update({ 
             adder: Number(r.adder), 
             party_basic: todayBasic + Number(r.adder) + Number(r.pAdder) 
          })
          .eq("id", s.id);
        if (error) throw new Error(`Section ${s.name} error: ${error.message}`);
      }
    },
    onSuccess: () => { toast.success("Section adders saved"); onSaved(); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex justify-between">
          <span>Section Adders</span>
          <Button size="sm" onClick={() => saveAllSections.mutate()} disabled={saveAllSections.isPending}>
            {saveAllSections.isPending ? "Saving…" : "Save All Sections"}
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b">
              <th className="p-2">Section</th>
              <th className="p-2">Adder</th>
              <th className="p-2">Party Adder</th>
            </tr>
          </thead>
          <tbody>
            {sections.map(s => (
              <tr key={s.id} className="border-b">
                <td className="p-2">{s.name}</td>
                <td className="p-2">
                  <Input className="w-20" type="number" value={rows[s.id]?.adder || 0} onChange={(e) => setRows(prev => ({ ...prev, [s.id]: { ...prev[s.id], adder: e.target.value } }))} />
                </td>
                <td className="p-2">
                  <Input className="w-20" type="number" value={rows[s.id]?.pAdder || 0} onChange={(e) => setRows(prev => ({ ...prev, [s.id]: { ...prev[s.id], pAdder: e.target.value } }))} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
