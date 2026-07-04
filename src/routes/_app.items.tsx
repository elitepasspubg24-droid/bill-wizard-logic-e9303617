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

/**
 * Parse an adder input that may be either:
 *   - a plain number      -> "11"    => 11
 *   - a percentage string -> "10%"   => 10% of `base`
 *   - blank / invalid     -> 0
 */
function parseAdder(input: string | number | undefined | null, base: number): number {
  if (input === null || input === undefined) return 0;
  const raw = String(input).trim();
  if (raw === "") return 0;

  if (raw.endsWith("%")) {
    const pct = Number(raw.slice(0, -1).trim());
    if (isNaN(pct)) return 0;
    return (Number(base) || 0) * (pct / 100);
  }

  const n = Number(raw);
  return isNaN(n) ? 0 : n;
}

/** True if the raw input string looks like a valid adder value (number or "N%"). */
function isValidAdderInput(input: string | number | undefined | null): boolean {
  if (input === null || input === undefined) return false;
  const raw = String(input).trim();
  if (raw === "") return false;
  if (raw.endsWith("%")) return !isNaN(Number(raw.slice(0, -1).trim()));
  return !isNaN(Number(raw));
}

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
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Daily Factory Rates</h1>
          <p className="text-sm text-muted-foreground">
            Update each factory's basic rate &amp; adders. All Today/Sauda/Party rates auto-recompute.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => setShowAddForm(!showAddForm)}
          className="gap-1.5"
        >
          <Plus className="h-4 w-4" />
          {showAddForm ? "Cancel" : "Add Factory"}
        </Button>
      </div>

      {showAddForm && (
        <Card>
          <CardHeader>
            <CardTitle>Register New Factory</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 md:flex-row md:items-end">
            <div className="flex-1">
              <Label>Factory Name</Label>
              <Input
                value={newFactoryName}
                onChange={(e) => setNewFactoryName(e.target.value)}
              />
            </div>
            <div className="flex-1">
              <Label>Initial Basic Rate</Label>
              <Input
                type="number"
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
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Factory className="h-4 w-4" /> Factory Basic Rates
          </CardTitle>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Bulk Shift:</span>
            <Button size="sm" variant="outline" onClick={() => adjustAllRates(-200)}>-200</Button>
            <Button size="sm" variant="outline" onClick={() => adjustAllRates(-100)}>-100</Button>
            <Button size="sm" variant="outline" onClick={() => adjustAllRates(100)}>+100</Button>
            <Button size="sm" variant="outline" onClick={() => adjustAllRates(200)}>+200</Button>
            <Button size="sm" variant="ghost" onClick={resetAllRates} className="gap-1">
              <RotateCcw className="h-3.5 w-3.5" /> Reset
            </Button>
            <Button size="sm" onClick={() => saveAllFactories.mutate()} disabled={saveAllFactories.isPending}>
              {saveAllFactories.isPending ? "Saving…" : "Save all"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {factories.data?.map((f) => (
            <div key={f.id} className="flex items-center gap-2">
              <div className="w-32 truncate text-sm">{f.name}</div>
              <Input
                type="number"
                value={factoryRates[f.id] ?? ""}
                onChange={(e) =>
                  setFactoryRates((prev) => ({ ...prev, [f.id]: e.target.value }))
                }
              />
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
  // Stored as raw strings so users can type "10%", "11", "12%" freely.
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
    if (!isValidAdderInput(globalPartyAdder)) {
      toast.error("Enter a valid number or percentage (e.g. 200 or 10%)");
      return;
    }
    setPAdders((prev) => {
      const next: Record<string, string> = {};
      for (const id of Object.keys(prev)) next[id] = globalPartyAdder.trim();
      return next;
    });
    toast.success("Applied party adder to all factories");
  };

  const saveAll = useMutation({
    mutationFn: async () => {
      const failures: string[] = [];
      for (const f of factories) {
        const basic = Number(f.basic_rate ?? 0);
        const aRaw = adders[f.id];
        const pRaw = pAdders[f.id];

        const aVal = parseAdder(aRaw, basic);
        const todaysRate = basic + aVal;
        const pVal = parseAdder(pRaw, todaysRate);

        const aChanged = isValidAdderInput(aRaw) && aVal !== Number(f.adder ?? 0);
        const pChanged = isValidAdderInput(pRaw) && pVal !== Number(f.party_adder ?? 0);
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
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Factory Adders</CardTitle>
        <div className="flex items-center gap-2">
          <Label className="text-xs">Party Adder (all):</Label>
          <Input
            className="w-28"
            type="text"
            inputMode="decimal"
            value={globalPartyAdder}
            onChange={(e) => setGlobalPartyAdder(e.target.value)}
            placeholder="e.g. 200 or 10%"
          />
          <Button size="sm" variant="outline" onClick={applyGlobalPartyAdder}>
            Apply to all
          </Button>
          <Button size="sm" onClick={() => saveAll.mutate()} disabled={saveAll.isPending}>
            {saveAll.isPending ? "Saving…" : "Save all"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-2 pr-3">Factory</th>
              <th className="py-2 pr-3">Today's Basic</th>
              <th className="py-2 pr-3">Adder (+ or %)</th>
              <th className="py-2 pr-3">Today's Rate</th>
              <th className="py-2 pr-3">Party Adder (+ or %)</th>
              <th className="py-2 pr-3">Party Rate</th>
            </tr>
          </thead>
          <tbody>
            {factories.map((f) => {
              const todayBasic = Number(f.basic_rate ?? 0);
              const adderVal = parseAdder(adders[f.id], todayBasic);
              const todayRate = todayBasic + adderVal;
              const pAdderVal = parseAdder(pAdders[f.id], todayRate);
              const partyRate = todayRate + pAdderVal;

              const aRaw = (adders[f.id] ?? "").trim();
              const pRaw = (pAdders[f.id] ?? "").trim();
              const aIsPct = aRaw.endsWith("%");
              const pIsPct = pRaw.endsWith("%");

              return (
                <tr key={f.id} className="border-t">
                  <td className="py-2 pr-3">{f.name}</td>
                  <td className="py-2 pr-3">{todayBasic.toFixed(0)}</td>
                  <td className="py-2 pr-3">
                    <Input
                      type="text"
                      inputMode="decimal"
                      className="w-28"
                      value={adders[f.id] ?? ""}
                      placeholder="e.g. 50 or 10%"
                      onChange={(e) =>
                        setAdders((prev) => ({ ...prev, [f.id]: e.target.value }))
                      }
                    />
                    {aIsPct && (
                      <div className="text-[10px] text-muted-foreground mt-0.5">
                        = {adderVal.toFixed(2)}
                      </div>
                    )}
                  </td>
                  <td className="py-2 pr-3 font-medium">{todayRate.toFixed(0)}</td>
                  <td className="py-2 pr-3">
                    <Input
                      type="text"
                      inputMode="decimal"
                      className="w-28"
                      value={pAdders[f.id] ?? ""}
                      placeholder="e.g. 200 or 5%"
                      onChange={(e) =>
                        setPAdders((prev) => ({ ...prev, [f.id]: e.target.value }))
                      }
                    />
                    {pIsPct && (
                      <div className="text-[10px] text-muted-foreground mt-0.5">
                        = {pAdderVal.toFixed(2)}
                      </div>
                    )}
                  </td>
                  <td className="py-2 pr-3 font-medium">{partyRate.toFixed(0)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
