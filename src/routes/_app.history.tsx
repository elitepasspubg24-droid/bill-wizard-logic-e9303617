import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchFactories, fetchSections } from "@/lib/queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

export const Route = createFileRoute("/_app/history")({
  component: HistoryPage,
  head: () => ({ meta: [{ title: "Rate History" }] }),
});

function dayKey(ts: string) {
  return new Date(ts).toISOString().slice(0, 10);
}

function fmtDate(d: string) {
  const dt = new Date(d);
  return dt.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

function HistoryPage() {
  const factories = useQuery({ queryKey: ["factories"], queryFn: fetchFactories });
  const sections = useQuery({ queryKey: ["sections"], queryFn: fetchSections });

  const fHistory = useQuery({
    queryKey: ["factory_history"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("factory_rate_history")
        .select("*")
        .order("changed_at", { ascending: true })
        .limit(2000);
      if (error) throw error;
      return data;
    },
  });

  const sHistory = useQuery({
    queryKey: ["section_history"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("section_rate_history")
        .select("*")
        .order("changed_at", { ascending: true })
        .limit(2000);
      if (error) throw error;
      return data;
    },
  });

  // Date -> factory_id -> last rate that day
  const factoryByDay = useMemo(() => {
    const m = new Map<string, Map<string, number>>();
    for (const r of fHistory.data ?? []) {
      const d = dayKey(r.changed_at);
      if (!m.has(d)) m.set(d, new Map());
      m.get(d)!.set(r.factory_id, Number(r.basic_rate));
    }
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [fHistory.data]);

  const sectionByDay = useMemo(() => {
    const m = new Map<string, Map<string, { adder: number; sauda: number; party: number }>>();
    for (const r of sHistory.data ?? []) {
      const d = dayKey(r.changed_at);
      if (!m.has(d)) m.set(d, new Map());
      m.get(d)!.set(r.section_id, {
        adder: Number(r.adder),
        sauda: Number(r.sauda_basic),
        party: Number(r.party_basic),
      });
    }
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [sHistory.data]);

  const facs = factories.data ?? [];
  const secs = sections.data ?? [];

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold">Rate History</h2>
        <p className="text-sm text-muted-foreground">
          One card per date. No horizontal scrolling — values wrap to fit your screen.
        </p>
      </div>

      <Tabs defaultValue="factories">
        <TabsList>
          <TabsTrigger value="factories">Factory Rates</TabsTrigger>
          <TabsTrigger value="sections">Section Rates</TabsTrigger>
        </TabsList>

        <TabsContent value="factories" className="space-y-3">
          {factoryByDay.map(([d, row]) => (
            <Card key={d}>
              <CardHeader className="py-3">
                <CardTitle className="text-sm font-semibold">{fmtDate(d)}</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                  {facs.map((f) => {
                    const v = row.get(f.id);
                    return (
                      <div
                        key={f.id}
                        className="rounded-md border bg-muted/30 px-3 py-2 flex flex-col"
                      >
                        <span className="text-xs text-muted-foreground truncate">{f.name}</span>
                        <span className="font-mono text-base font-semibold">
                          {v ?? <span className="text-muted-foreground">—</span>}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          ))}
          {!factoryByDay.length && (
            <Card><CardContent className="p-6 text-center text-muted-foreground">No history yet.</CardContent></Card>
          )}
        </TabsContent>

        <TabsContent value="sections" className="space-y-3">
          {sectionByDay.map(([d, row]) => (
            <Card key={d}>
              <CardHeader className="py-3">
                <CardTitle className="text-sm font-semibold">{fmtDate(d)}</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                  {secs.map((s) => {
                    const v = row.get(s.id);
                    return (
                      <div key={s.id} className="rounded-md border bg-muted/30 px-3 py-2">
                        <div className="text-xs font-medium truncate mb-1">{s.name}</div>
                        <div className="grid grid-cols-3 gap-1 text-center">
                          <div>
                            <div className="text-[10px] uppercase text-muted-foreground">Adder</div>
                            <div className="font-mono text-sm">{v ? v.adder : "—"}</div>
                          </div>
                          <div>
                            <div className="text-[10px] uppercase text-muted-foreground">Sauda</div>
                            <div className="font-mono text-sm">{v ? v.sauda : "—"}</div>
                          </div>
                          <div>
                            <div className="text-[10px] uppercase text-muted-foreground">Party</div>
                            <div className="font-mono text-sm">{v ? v.party : "—"}</div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          ))}
          {!sectionByDay.length && (
            <Card><CardContent className="p-6 text-center text-muted-foreground">No history yet.</CardContent></Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
