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

export const Route = createFileRoute("/_app/")({
  component: RatesPage,
  head: () => ({ meta: [{ title: "Daily Rates" }] }),
});

function RatesPage() {
  const qc = useQueryClient();
  const factories = useQuery({ queryKey: ["factories"], queryFn: fetchFactories });
  const sections = useQuery({ queryKey: ["sections"], queryFn: fetchSections });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Daily Factory Rates</h2>
        <p className="text-sm text-muted-foreground">
          Update each factory's basic rate. All Today/Sauda/Party rates auto-recompute.
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle>Factory Basic Rates</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {factories.data?.map((f) => (
            <FactoryRow key={f.id} factory={f} onSaved={() => qc.invalidateQueries({ queryKey: ["factories"] })} />
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

function FactoryRow({ factory, onSaved }: { factory: any; onSaved: () => void }) {
  const [v, setV] = useState(String(factory.basic_rate));
  useEffect(() => setV(String(factory.basic_rate)), [factory.basic_rate]);
  const mut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("factories")
        .update({ basic_rate: Number(v), updated_at: new Date().toISOString() })
        .eq("id", factory.id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success(`${factory.name} updated`); onSaved(); },
    onError: (e: any) => toast.error(e.message),
  });
  return (
    <div className="border rounded-md p-3">
      <Label className="text-xs">{factory.name}</Label>
      <div className="flex gap-2 mt-1">
        <Input type="number" value={v} onChange={(e) => setV(e.target.value)} />
        <Button size="sm" onClick={() => mut.mutate()} disabled={mut.isPending}>Save</Button>
      </div>
    </div>
  );
}

type RowState = { adder: string; sb: string; pAdder: string };

function SectionsCard({ sections, factories, onSaved }: { sections: any[]; factories: any[]; onSaved: () => void }) {
  const [globalPartyAdder, setGlobalPartyAdder] = useState("");
  const [rows, setRows] = useState<Record<string, RowState>>({});

  // Initialize / sync row state when section data changes
  useEffect(() => {
    setRows((prev) => {
      const next: Record<string, RowState> = {};
      for (const s of sections) {
        const existing = prev[s.id];
        const derivedPartyAdder = Number(s.party_basic) - Number(s.sauda_basic);
        next[s.id] = existing ?? {
          adder: String(s.adder),
          sb: String(s.sauda_basic),
          pAdder: Number.isFinite(derivedPartyAdder) ? String(derivedPartyAdder) : "0",
        };
      }
      return next;
    });
  }, [sections]);

  const updateRow = (id: string, patch: Partial<RowState>) =>
    setRows((r) => ({ ...r, [id]: { ...r[id], ...patch } }));

  const applyGlobal = () => {
    setRows((r) => {
      const next: Record<string, RowState> = {};
      for (const id of Object.keys(r)) next[id] = { ...r[id], pAdder: globalPartyAdder };
      return next;
    });
    toast.success("Applied to all sections");
  };

  const saveAll = useMutation({
    mutationFn: async () => {
      const updates = sections.map((s) => {
        const r = rows[s.id];
        const sb = Number(r.sb) || 0;
        const pAdder = Number(r.pAdder) || 0;
        return supabase
          .from("sections")
          .update({ adder: Number(r.adder) || 0, sauda_basic: sb, party_basic: sb + pAdder })
          .eq("id", s.id);
      });
      const results = await Promise.all(updates);
      const err = results.find((x) => x.error)?.error;
      if (err) throw err;
    },
    onSuccess: () => { toast.success("All sections saved"); onSaved(); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-3">
          <span>Section Adders & Basics</span>
          <div className="flex items-center gap-2 text-sm font-normal">
            <Label className="text-xs">Party Adder (all):</Label>
            <Input
              className="w-24"
              type="number"
              value={globalPartyAdder}
              onChange={(e) => setGlobalPartyAdder(e.target.value)}
              placeholder="e.g. 200"
            />
            <Button size="sm" variant="secondary" onClick={applyGlobal}>Apply to all</Button>
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
              <th className="p-2">Section</th>
              <th className="p-2">Factory</th>
              <th className="p-2">Today's Basic</th>
              <th className="p-2">Adder (+)</th>
              <th className="p-2">Today's Rate</th>
              <th className="p-2">Sauda Basic</th>
              <th className="p-2">Party Adder (+)</th>
              <th className="p-2">Party Basic</th>
            </tr>
          </thead>
          <tbody>
            {sections.map((s) => {
              const factory = factories.find((f: any) => f.id === s.factory_id);
              const r = rows[s.id] ?? { adder: "0", sb: "0", pAdder: "0" };
              const todayBasic = Number(factory?.basic_rate ?? 0);
              const todayRate = todayBasic + (Number(r.adder) || 0);
              const partyBasic = (Number(r.sb) || 0) + (Number(r.pAdder) || 0);
              return (
                <tr key={s.id} className="border-b">
                  <td className="p-2 font-medium">{s.name}</td>
                  <td className="p-2 text-muted-foreground">{factory?.name ?? "—"}</td>
                  <td className="p-2 font-mono text-muted-foreground">{todayBasic.toFixed(0)}</td>
                  <td className="p-2">
                    <Input className="w-24" type="number" value={r.adder}
                      onChange={(e) => updateRow(s.id, { adder: e.target.value })} />
                  </td>
                  <td className="p-2 font-mono font-semibold text-primary">{todayRate.toFixed(0)}</td>
                  <td className="p-2">
                    <Input className="w-24" type="number" value={r.sb}
                      onChange={(e) => updateRow(s.id, { sb: e.target.value })} />
                  </td>
                  <td className="p-2">
                    <Input className="w-24" type="number" value={r.pAdder}
                      onChange={(e) => updateRow(s.id, { pAdder: e.target.value })} />
                  </td>
                  <td className="p-2 font-mono font-semibold">{partyBasic.toFixed(0)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

