import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { fetchFactories } from "@/lib/queries";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { RotateCcw, Plus, Factory } from "lucide-react";

export const Route = createFileRoute("/_app/")({
  component: RatesPage,
  head: () => ({ meta: [{ title: "Daily Rates" }] }),
});

function RatesPage() {
  const qc = useQueryClient();
  const factories = useQuery({ queryKey: ["factories"], queryFn: fetchFactories });

  const [factoryRates, setFactoryRates] = useState<Record<string, string>>({});
  const [showAddForm, setShowAddForm] = useState(false);
  const [newFactoryName, setNewFactoryName] = useState("");
  const [newFactoryRate, setNewFactoryRate] = useState("");

  const [factoryAdders, setFactoryAdders] = useState<Record<string, { adder: string; pAdder: string }>>({});

  useEffect(() => {
    if (factories.data) {
      const initialRates: Record<string, string> = {};
      const initialAdders: Record<string, { adder: string; pAdder: string }> = {};
      
      for (const f of factories.data) {
        initialRates[f.id] = String(f.basic_rate);
        
        // Deriving factory adders or defaulting to zero if fields are not present
        initialAdders[f.id] = {
          adder: String((f as any).adder ?? "0"),
          pAdder: String((f as any).party_adder ?? "0")
        };
      }
      setFactoryRates(initialRates);
      setFactoryAdders(initialAdders);
    }
  }, [factories.data]);

  const adjustAllRates = (amount: number) => {
    setFactoryRates((prev) => {
      const next: Record<string, string> = { ...prev };
      (factories.data ?? []).forEach((f) => {
        const currentVal = Number(prev[f.id]) || Number(f.basic_rate) || 0;
        next[f.id] = String(currentVal + amount);
      });
      return next;
    });
    toast.success(`Adjusted all factories by ${amount > 0 ? `+${amount}` : amount}`);
  };

  const resetAllRates = () => {
    if (factories.data) {
      const initialRates: Record<string, string> = {};
      for (const f of factories.data) {
        initialRates[f.id] = String(f.basic_rate);
      }
      setFactoryRates(initialRates);
      toast.info("Reset inputs to saved rates");
    }
  };

  const addFactory = useMutation({
    mutationFn: async () => {
      if (!newFactoryName.trim() || !newFactoryRate.trim()) {
        throw new Error("Please enter both factory name and initial rate.");
      }
      const { error } = await supabase
        .from("factories")
        .insert({
          name: newFactoryName.trim(),
          basic_rate: Number(newFactoryRate),
          adder: 0,
          party_adder: 0,
          updated_at: new Date().toISOString(),
        });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("New factory added successfully");
      setNewFactoryName("");
      setNewFactoryRate("");
      setShowAddForm(false);
      qc.invalidateQueries({ queryKey: ["factories"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const saveAll = useMutation({
    mutationFn: async () => {
      const failures: string[] = [];
      for (const f of factories.data ?? []) {
        const rateVal = Number(factoryRates[f.id]);
        const adderObj = factoryAdders[f.id] ?? { adder: "0", pAdder: "0" };
        
        const { error } = await supabase
          .from("factories")
          .update({ 
            basic_rate: isNaN(rateVal) ? Number(f.basic_rate) : rateVal,
            adder: Number(adderObj.adder) || 0,
            party_adder: Number(adderObj.pAdder) || 0,
            updated_at: new Date().toISOString() 
          })
          .eq("id", f.id);
          
        if (error) failures.push(`${f.name}: ${error.message}`);
      }
      if (failures.length) throw new Error(failures.join(" | "));
    },
    onSuccess: () => {
      toast.success("All updates committed successfully");
      qc.invalidateQueries({ queryKey: ["factories"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const updateAdderRow = (id: string, patch: Partial<{ adder: string; pAdder: string }>) => {
    setFactoryAdders(prev => ({
      ...prev,
      [id]: { ...(prev[id] ?? { adder: "0", pAdder: "0" }), ...patch }
    }));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold">Daily Factory Control</h2>
          <p className="text-sm text-muted-foreground">
            Configure raw basic rates and macro system adders assigned to each manufacturing hub.
          </p>
        </div>
        <Button 
          size="sm" 
          variant={showAddForm ? "outline" : "default"} 
          onClick={() => setShowAddForm(!showAddForm)}
          className="gap-1.5"
        >
          <Plus className="h-4 w-4" />
          {showAddForm ? "Cancel" : "Add Factory"}
        </Button>
      </div>

      {showAddForm && (
        <Card className="border-primary/20 bg-muted/10">
          <CardHeader className="py-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Factory className="h-4 w-4 text-primary" />
              Register New Factory
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3 items-end pb-4">
            <div className="space-y-1">
              <Label htmlFor="fac-name" className="text-xs">Factory Name</Label>
              <Input 
                id="fac-name" 
                placeholder="e.g. Jindal Plant" 
                value={newFactoryName} 
                onChange={(e) => setNewFactoryName(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="fac-rate" className="text-xs">Initial Basic Rate</Label>
              <Input 
                id="fac-rate" 
                type="number" 
                placeholder="e.g. 45000" 
                value={newFactoryRate} 
                onChange={(e) => setNewFactoryRate(e.target.value)}
              />
            </div>
            <Button onClick={() => addFactory.mutate()} disabled={addFactory.isPending}>
              {addFactory.isPending ? "Creating..." : "Save Factory"}
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4 flex-wrap">
              <span>Factory Pricing Core</span>
              <div className="flex items-center gap-1 border rounded-lg p-1 bg-muted/40 font-normal">
                <span className="text-xs font-semibold px-2 text-muted-foreground">Bulk Shift:</span>
                <button type="button" className="h-7 px-2 text-xs rounded bg-background border border-red-200 text-red-600 hover:bg-red-50 font-medium transition-colors" onClick={() => adjustAllRates(-200)}>-200</button>
                <button type="button" className="h-7 px-2 text-xs rounded bg-background border border-red-100 text-red-500 hover:bg-red-50 font-medium transition-colors" onClick={() => adjustAllRates(-100)}>-100</button>
                <button type="button" className="h-7 px-2 text-xs rounded bg-background border border-emerald-100 text-emerald-500 hover:bg-emerald-50 font-medium transition-colors" onClick={() => adjustAllRates(100)}>+100</button>
                <button type="button" className="h-7 px-2 text-xs rounded bg-background border border-emerald-200 text-emerald-600 hover:bg-emerald-50 font-medium transition-colors" onClick={() => adjustAllRates(200)}>+200</button>
                <button type="button" className="h-7 px-2 text-xs rounded text-muted-foreground hover:text-foreground flex items-center gap-1 px-1.5 transition-colors" onClick={resetAllRates}>
                  <RotateCcw className="h-3 w-3" />
                  Reset
                </button>
              </div>
            </div>
            <Button size="sm" onClick={() => saveAll.mutate()} disabled={saveAll.isPending}>
              {saveAll.isPending ? "Saving Core Changes…" : "Save all changes"}
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b">
              <tr className="text-left text-xs text-muted-foreground bg-muted/30">
                <th className="p-3">Factory Name</th>
                <th className="p-3 w-40">Basic Rate</th>
                <th className="p-3 w-40 text-center">Factory Adder (+)</th>
                <th className="p-3 w-40 text-right">Computed Base Today</th>
                <th className="p-3 w-40 text-center">Party Adder (+)</th>
                <th className="p-3 w-40 text-right">Computed Base Party</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {factories.data?.map((f) => {
                const liveRate = Number(factoryRates[f.id]) || 0;
                const adders = factoryAdders[f.id] ?? { adder: "0", pAdder: "0" };
                
                const computedToday = liveRate + (Number(adders.adder) || 0);
                const computedParty = computedToday + (Number(adders.pAdder) || 0);

                return (
                  <tr key={f.id} className="hover:bg-muted/10 transition-colors">
                    <td className="p-3 font-semibold text-slate-900">{f.name}</td>
                    <td className="p-3">
                      <Input 
                        type="number" 
                        value={factoryRates[f.id] ?? ""} 
                        onChange={(e) => setFactoryRates(prev => ({ ...prev, [f.id]: e.target.value }))} 
                        className="h-9"
                      />
                    </td>
                    <td className="p-3">
                      <Input 
                        type="number" 
                        value={adders.adder} 
                        onChange={(e) => updateAdderRow(f.id, { adder: e.target.value })} 
                        className="h-9 text-center w-32 mx-auto"
                      />
                    </td>
                    <td className="p-3 text-right font-mono font-bold text-primary">
                      ₹{computedToday.toFixed(0)}
                    </td>
                    <td className="p-3">
                      <Input 
                        type="number" 
                        value={adders.pAdder} 
                        onChange={(e) => updateAdderRow(f.id, { pAdder: e.target.value })} 
                        className="h-9 text-center w-32 mx-auto"
                      />
                    </td>
                    <td className="p-3 text-right font-mono font-bold text-slate-800">
                      ₹{computedParty.toFixed(0)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
