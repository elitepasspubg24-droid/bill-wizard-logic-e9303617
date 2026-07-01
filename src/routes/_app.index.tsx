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

  useEffect(() => {
    if (factories.data) {
      const initial: Record<string, string> = {};
      for (const f of factories.data) initial[f.id] = String(f.basic_rate);
      setFactoryRates(initial);
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
      const initial: Record<string, string> = {};
      for (const f of factories.data) initial[f.id] = String(f.basic_rate);
      setFactoryRates(initial);
      toast.info("Reset inputs to saved rates");
    }
  };

  const addFactory = useMutation({
    mutationFn: async () => {
      if (!newFactoryName.trim() || !newFactoryRate.trim()) {
        throw new Error("Please enter both factory name and initial rate.");
      }
      const { error } = await supabase.from("factories").insert({
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

  const saveAllFactories = useMutation({
    mutationFn: async () => {
      const failures: string[] = [];
      for (const f of factories.data ?? []) {
        const val = Number(factoryRates[f.id]);
        if (isNaN(val) || val === Number(f.basic_rate)) continue;
        const { error } = await supabase
          .from("factories")
          .update({ basic_rate: val, updated_at: new Date().toISOString() })
          .eq("id", f.id);
        if (error) failures.push(`${f.name}: ${error.message}`);
      }
      if (failures.length) throw new Error(failures.join(" | "));
    },
    onSuccess: () => {
      toast.success("All factory rates updated");
      qc.invalidateQueries({ queryKey: ["factories"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold">Daily Factory Rates</h2>
          <p className="text-sm text-muted-foreground">
            Update each factory's basic rate & adders. All Today/Sauda/Party rates auto-recompute.
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
                placeholder="e.g. Balaji Steels"
                value={newFactoryName}
                onChange={(e) => setNewFactoryName(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="fac-rate" className="text-xs">Initial Basic Rate</Label>
              <Input
                id="fac-rate"
                type="number"
                placeholder="e.g. 42000"
                value={newFactoryRate}
                onChange={(e) => setNewFactoryRate(e.target.value)}
              />
            </div>
            <Button size="default" onClick={() => addFactory.mutate()} disabled={addFactory.isPending}>
              {addFactory.isPending ? "Creating..." : "Save Factory"}
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4 flex-wrap">
              <span>Factory Basic Rates</span>

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

            <Button size="sm" onClick={() => saveAllFactories.mutate()} disabled={saveAllFactories.isPending}>
              {saveAllFactories.isPending ? "Saving…" : "Save all"}
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {factories.data?.map((f) => (
            <div key={f.id} className="border rounded-md p-3">
              <Label className="text-xs">{f.name}</Label>
              <div className="flex gap-2 mt-1">
                <Input
                  type="number"
                  value={factoryRates[f.id] ?? ""}
                  onChange={(e) => setFactoryRates(prev => ({ ...prev, [f.id]: e.target.value }))}
                />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <FactoryAddersCard
        factories={factories.data ?? []}
        onSaved={() => qc.invalidateQueries({ queryKey: ["factories"] })}
      />
    </div>
  );
}

function FactoryAddersCard({ factories, onSaved }: { factories: any[]; onSaved: () => void }) {
  const [adders, setAdders] = useState<Record<string, string>>({});
  const [pAdders, setPAdders] = useState<Record<string, string>>({});
  const [globalPartyAdder, setGlobalPartyAdder] = useState("");

  useEffect(() => {
    setAdders((prev) => {
      const next: Record<string, string> = {};
      for (const f of factories) next[f.id] = prev[f.id] ?? String(f.adder ?? 0);
      return next;
    });
    setPAdders((prev) => {
      const next: Record<string, string> = {};
      for (const f of factories) next[f.id] = prev[f.id] ?? String(f.party_adder ?? 0);
      return next;
    });
  }, [factories]);

  const applyGlobalPartyAdder = () => {
    setPAdders((prev) => {
      const next: Record<string, string> = {};
      for (const id of Object.keys(prev)) next[id] = globalPartyAdder;
      return next;
    });
    toast.success("Applied party adder to all factories");
  };

  const saveAll = useMutation({
    mutationFn: async () => {
      const failures: string[] = [];
      for (const f of factories) {
        const aVal = Number(adders[f.id]);
        const pVal = Number(pAdders[f.id]);
        const aChanged = !isNaN(aVal) && aVal !== Number(f.adder ?? 0);
        const pChanged = !isNaN(pVal) && pVal !== Number(f.party_adder ?? 0);
        if (!aChanged && !pChanged) continue;

        const patch: any = { updated_at: new Date().toISOString() };
        if (aChanged) patch.adder = aVal;
        if (pChanged) patch.party_adder = pVal;

        const { error } = await supabase.from("factories").update(patch).eq("id", f.id);
        if (error) failures.push(`${f.name}: ${error.message}`);
      }
      if (failures.length) throw new Error(failures.join(" | "));
    },
    onSuccess: () => { toast.success("All factory adders saved"); onSaved(); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-3">
          <span>Factory Adders</span>
          <div className="flex items-center gap-2 text-sm font-normal">
            <Label className="text-xs">Party Adder (all):</Label>
            <Input
              className="w-24"
              type="number"
              value={globalPartyAdder}
              onChange={(e) => setGlobalPartyAdder(e.target.value)}
              placeholder="e.g. 200"
            />
            <Button size="sm" variant="secondary" onClick={applyGlobalPartyAdder}>Apply to all</Button>
            <Button size="sm" onClick={() => saveAll.mutate()} disabled={saveAll.isPending}>
              {saveAll.isPending ? "Saving…" : "Save all"}
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b">
            <tr className="text-left">
              <th className="p-2">Factory</th>
              <th className="p-2">Today's Basic</th>
              <th className="p-2">Adder (+)</th>
              <th className="p-2">Today's Rate</th>
              <th className="p-2">Party Adder (+)</th>
              <th className="p-2">Party Rate</th>
            </tr>
          </thead>
          <tbody>
            {factories.map((f) => {
              const todayBasic = Number(f.basic_rate ?? 0);
              const adderVal = Number(adders[f.id]) || 0;
              const pAdderVal = Number(pAdders[f.id]) || 0;
              const todayRate = todayBasic + adderVal;
              const partyRate = todayRate + pAdderVal;
              return (
                <tr key={f.id} className="border-b">
                  <td className="p-2 font-medium">{f.name}</td>
                  <td className="p-2 font-mono text-muted-foreground">{todayBasic.toFixed(0)}</td>
                  <td className="p-2">
                    <Input
                      className="w-24"
                      type="number"
                      value={adders[f.id] ?? ""}
                      onChange={(e) => setAdders((prev) => ({ ...prev, [f.id]: e.target.value }))}
                    />
                  </td>
                  <td className="p-2 font-mono font-semibold text-primary">{todayRate.toFixed(0)}</td>
                  <td className="p-2">
                    <Input
                      className="w-24"
                      type="number"
                      value={pAdders[f.id] ?? ""}
                      onChange={(e) => setPAdders((prev) => ({ ...prev, [f.id]: e.target.value }))}
                    />
                  </td>
                  <td className="p-2 font-mono font-semibold">{partyRate.toFixed(0)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
