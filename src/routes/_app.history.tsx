import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchFactories } from "@/lib/queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { format, eachDayOfInterval, startOfDay } from "date-fns";

export const Route = createFileRoute("/_app/history")({
  component: HistoryPage,
});

function HistoryPage() {
  const factories = useQuery({ queryKey: ["factories"], queryFn: fetchFactories });
  const fHistory = useQuery({
    queryKey: ["factory_history"],
    queryFn: async () => {
      const { data, error } = await supabase.from("factory_rate_history").select("*").order("changed_at", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const carryForwardHistory = useMemo(() => {
    if (!fHistory.data?.length || !factories.data) return [];
    const start = startOfDay(new Date(fHistory.data[0].changed_at));
    const end = startOfDay(new Date());
    const days = eachDayOfInterval({ start, end });

    const lastKnown = new Map<string, number>();
    const historyByDay = new Map<string, Map<string, number>>();
    fHistory.data.forEach(h => {
      const d = format(new Date(h.changed_at), "yyyy-MM-dd");
      if (!historyByDay.has(d)) historyByDay.set(d, new Map());
      historyByDay.get(d)!.set(h.factory_id, Number(h.basic_rate));
    });

    return days.map(day => {
      const dStr = format(day, "yyyy-MM-dd");
      const changes = historyByDay.get(dStr);
      if (changes) changes.forEach((val, fid) => lastKnown.set(fid, val));
      const snapshot = new Map<string, number>();
      factories.data!.forEach(f => {
        const rate = lastKnown.get(f.id);
        if (rate !== undefined) snapshot.set(f.id, rate);
      });
      return { date: dStr, rates: snapshot };
    }).reverse();
  }, [fHistory.data, factories.data]);

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">Daily Rate History</h2>
      {carryForwardHistory.map((day) => (
        <Card key={day.date} className="shadow-sm">
          <CardHeader className="py-2 px-4 border-b bg-muted/20">
            <CardTitle className="text-xs font-black uppercase text-slate-500 tracking-widest">{format(new Date(day.date), "dd MMM yyyy")}</CardTitle>
          </CardHeader>
          <CardContent className="p-3 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
            {factories.data?.map(f => (
              <div key={f.id} className="rounded-md border p-2 bg-background flex flex-col">
                <div className="text-[9px] text-muted-foreground uppercase font-bold truncate">{f.name}</div>
                <div className="font-mono text-sm font-bold text-slate-800">{day.rates.get(f.id) ?? "—"}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
