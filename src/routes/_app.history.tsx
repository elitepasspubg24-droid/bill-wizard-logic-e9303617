--- START OF FILE bill-wizard-logic-e9303617-main/src/routes/_app.history.tsx ---
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchFactories, fetchSections } from "@/lib/queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { format, eachDayOfInterval, startOfDay, isSameDay } from "date-fns";

export const Route = createFileRoute("/_app/history")({
  component: HistoryPage,
  head: () => ({ meta: [{ title: "Rate History" }] }),
});

function HistoryPage() {
  const factories = useQuery({ queryKey: ["factories"], queryFn: fetchFactories });
  const sections = useQuery({ queryKey: ["sections"], queryFn: fetchSections });

  const fHistory = useQuery({
    queryKey: ["factory_history"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("factory_rate_history")
        .select("*")
        .order("changed_at", { ascending: true });
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
        .order("changed_at", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  // --- Carry Forward Logic for Factories ---
  const factoryHistoryByDay = useMemo(() => {
    if (!fHistory.data?.length || !factories.data) return [];
    
    // 1. Get range: from first record until today
    const start = startOfDay(new Date(fHistory.data[0].changed_at));
    const end = startOfDay(new Date());
    const allDays = eachDayOfInterval({ start, end }).reverse();

    // 2. Track the "current" rate for each factory
    const lastKnownRates = new Map<string, number>();
    
    // 3. Build a map of actual changes by date
    const changesByDay = new Map<string, Map<string, number>>();
    for (const h of fHistory.data) {
      const day = format(new Date(h.changed_at), "yyyy-MM-dd");
      if (!changesByDay.has(day)) changesByDay.set(day, new Map());
      changesByDay.get(day)!.set(h.factory_id, Number(h.basic_rate));
    }

    // 4. Fill gaps by carrying forward
    // Since we need to carry forward, we actually need to process chronologically first
    const chronologicalDays = [...allDays].reverse();
    const result: [string, Map<string, number>][] = [];

    for (const d of chronologicalDays) {
      const dayStr = format(d, "yyyy-MM-dd");
      const changesToday = changesByDay.get(dayStr);
      
      // Update our tracker with any new rates from today
      if (changesToday) {
        for (const [fid, rate] of changesToday) {
          lastKnownRates.set(fid, rate);
        }
      }

      // Create a snapshot of all factories for this day
      const daySnapshot = new Map<string, number>();
      for (const f of factories.data) {
        const rate = lastKnownRates.get(f.id);
        if (rate !== undefined) daySnapshot.set(f.id, rate);
      }
      
      if (daySnapshot.size > 0) {
        result.push([dayStr, daySnapshot]);
      }
    }

    return result.reverse(); // Back to latest first
  }, [fHistory.data, factories.data]);

  // --- Carry Forward Logic for Sections ---
  const sectionHistoryByDay = useMemo(() => {
    if (!sHistory.data?.length || !sections.data) return [];
    
    const start = startOfDay(new Date(sHistory.data[0].changed_at));
    const end = startOfDay(new Date());
    const allDays = eachDayOfInterval({ start, end }).reverse();

    const lastKnown = new Map<string, any>();
    const changesByDay = new Map<string, Map<string, any>>();
    
    for (const h of sHistory.data) {
      const day = format(new Date(h.changed_at), "yyyy-MM-dd");
      if (!changesByDay.has(day)) changesByDay.set(day, new Map());
      changesByDay.get(day)!.set(h.section_id, h);
    }

    const result: [string, Map<string, any>][] = [];
    const chronologicalDays = [...allDays].reverse();

    for (const d of chronologicalDays) {
      const dayStr = format(d, "yyyy-MM-dd");
      const changesToday = changesByDay.get(dayStr);
      
      if (changesToday) {
        for (const [sid, data] of changesToday) lastKnown.set(sid, data);
      }

      const snapshot = new Map<string, any>();
      for (const s of sections.data) {
        const data = lastKnown.get(s.id);
        if (data) snapshot.set(s.id, data);
      }
      if (snapshot.size > 0) result.push([dayStr, snapshot]);
    }

    return result.reverse();
  }, [sHistory.data, sections.data]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold">Rate History</h2>
        <p className="text-sm text-muted-foreground">
          Showing daily snapshots. Rates are carried forward from the last change date.
        </p>
      </div>

      <Tabs defaultValue="factories">
        <TabsList className="grid w-full grid-cols-2 max-w-[400px]">
          <TabsTrigger value="factories">Factory Basic</TabsTrigger>
          <TabsTrigger value="sections">Section Detailed</TabsTrigger>
        </TabsList>

        <TabsContent value="factories" className="space-y-3">
          {factoryHistoryByDay.map(([date, row]) => (
            <Card key={date}>
              <CardHeader className="py-2 px-4 border-b bg-muted/10">
                <CardTitle className="text-xs font-bold uppercase text-muted-foreground">
                  {format(new Date(date), "dd MMM yyyy")}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3">
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
                  {factories.data?.map((f) => {
                    const v = row.get(f.id);
                    return (
                      <div key={f.id} className="rounded border p-2 flex flex-col gap-1">
                        <span className="text-[10px] text-muted-foreground truncate uppercase font-semibold">{f.name}</span>
                        <span className="font-mono text-sm font-bold">
                          {v ?? "—"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="sections" className="space-y-3">
          {sectionHistoryByDay.map(([date, row]) => (
            <Card key={date}>
              <CardHeader className="py-2 px-4 border-b bg-muted/10">
                <CardTitle className="text-xs font-bold uppercase text-muted-foreground">
                  {format(new Date(date), "dd MMM yyyy")}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  {sections.data?.map((s) => {
                    const v = row.get(s.id);
                    return (
                      <div key={s.id} className="rounded border p-2 space-y-2">
                        <div className="text-[10px] font-bold uppercase truncate border-b pb-1">{s.name}</div>
                        <div className="grid grid-cols-3 gap-1">
                          <div className="text-center">
                            <div className="text-[9px] text-muted-foreground uppercase">Adder</div>
                            <div className="font-mono text-xs font-bold">{v ? v.adder : "—"}</div>
                          </div>
                          <div className="text-center">
                            <div className="text-[9px] text-muted-foreground uppercase">Sauda</div>
                            <div className="font-mono text-xs font-bold text-orange-600">{v ? v.sauda_basic : "—"}</div>
                          </div>
                          <div className="text-center">
                            <div className="text-[9px] text-muted-foreground uppercase">Party</div>
                            <div className="font-mono text-xs font-bold text-primary">{v ? v.party_basic : "—"}</div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}
