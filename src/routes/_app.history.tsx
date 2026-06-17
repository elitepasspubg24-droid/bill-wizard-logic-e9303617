import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchFactories, fetchSections } from "@/lib/queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_app/history")({
  component: HistoryPage,
  head: () => ({ meta: [{ title: "Rate History" }] }),
});

function fmt(ts: string) {
  return new Date(ts).toLocaleString();
}

function diffBadge(prev: number | null, cur: number) {
  if (prev === null) return <Badge variant="outline">initial</Badge>;
  const d = cur - prev;
  if (d === 0) return <Badge variant="outline">no change</Badge>;
  return (
    <Badge variant={d > 0 ? "default" : "secondary"}>
      {d > 0 ? "+" : ""}{d}
    </Badge>
  );
}

function HistoryPage() {
  const factories = useQuery({ queryKey: ["factories"], queryFn: fetchFactories });
  const sections = useQuery({ queryKey: ["sections"], queryFn: fetchSections });

  const [factoryId, setFactoryId] = useState<string>("all");
  const [sectionId, setSectionId] = useState<string>("all");

  const fHistory = useQuery({
    queryKey: ["factory_history", factoryId],
    queryFn: async () => {
      let q = supabase
        .from("factory_rate_history")
        .select("*")
        .order("changed_at", { ascending: false })
        .limit(500);
      if (factoryId !== "all") q = q.eq("factory_id", factoryId);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
  });

  const sHistory = useQuery({
    queryKey: ["section_history", sectionId],
    queryFn: async () => {
      let q = supabase
        .from("section_rate_history")
        .select("*")
        .order("changed_at", { ascending: false })
        .limit(500);
      if (sectionId !== "all") q = q.eq("section_id", sectionId);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
  });

  const fMap = useMemo(
    () => new Map((factories.data ?? []).map((f) => [f.id, f.name])),
    [factories.data],
  );
  const sMap = useMemo(
    () => new Map((sections.data ?? []).map((s) => [s.id, s.name])),
    [sections.data],
  );

  // attach "prev" per group (factory/section) for diff badges
  const fRows = useMemo(() => {
    const grouped = new Map<string, any[]>();
    (fHistory.data ?? []).forEach((r) => {
      const arr = grouped.get(r.factory_id) ?? [];
      arr.push(r);
      grouped.set(r.factory_id, arr);
    });
    const out: any[] = [];
    grouped.forEach((arr) => {
      // arr is desc by changed_at; prev = next item in array
      arr.forEach((r, i) => {
        const prev = arr[i + 1]?.basic_rate ?? null;
        out.push({ ...r, prev });
      });
    });
    return out.sort((a, b) => (a.changed_at < b.changed_at ? 1 : -1));
  }, [fHistory.data]);

  const sRows = useMemo(() => {
    const grouped = new Map<string, any[]>();
    (sHistory.data ?? []).forEach((r) => {
      const arr = grouped.get(r.section_id) ?? [];
      arr.push(r);
      grouped.set(r.section_id, arr);
    });
    const out: any[] = [];
    grouped.forEach((arr) => {
      arr.forEach((r, i) => {
        const prev = arr[i + 1] ?? null;
        out.push({ ...r, prev });
      });
    });
    return out.sort((a, b) => (a.changed_at < b.changed_at ? 1 : -1));
  }, [sHistory.data]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold">Rate History</h2>
        <p className="text-sm text-muted-foreground">
          Every change to factory basic rates and section adders/basics is recorded with a timestamp.
        </p>
      </div>

      <Tabs defaultValue="factories">
        <TabsList>
          <TabsTrigger value="factories">Factory Rates</TabsTrigger>
          <TabsTrigger value="sections">Section Rates</TabsTrigger>
        </TabsList>

        <TabsContent value="factories">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <CardTitle className="text-base">Factory basic rate changes</CardTitle>
              <Select value={factoryId} onValueChange={setFactoryId}>
                <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All factories</SelectItem>
                  {factories.data?.map((f) => (
                    <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b text-left text-muted-foreground">
                  <tr>
                    <th className="p-2">When</th>
                    <th className="p-2">Factory</th>
                    <th className="p-2 text-right">Basic Rate</th>
                    <th className="p-2">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {fRows.map((r) => (
                    <tr key={r.id} className="border-b last:border-0">
                      <td className="p-2 whitespace-nowrap">{fmt(r.changed_at)}</td>
                      <td className="p-2 font-medium">{fMap.get(r.factory_id) ?? r.factory_id}</td>
                      <td className="p-2 text-right font-mono">{Number(r.basic_rate)}</td>
                      <td className="p-2">{diffBadge(r.prev !== null ? Number(r.prev) : null, Number(r.basic_rate))}</td>
                    </tr>
                  ))}
                  {!fRows.length && (
                    <tr><td colSpan={4} className="p-6 text-center text-muted-foreground">No history yet.</td></tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sections">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <CardTitle className="text-base">Section adder / basic changes</CardTitle>
              <Select value={sectionId} onValueChange={setSectionId}>
                <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All sections</SelectItem>
                  {sections.data?.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b text-left text-muted-foreground">
                  <tr>
                    <th className="p-2">When</th>
                    <th className="p-2">Section</th>
                    <th className="p-2 text-right">Adder</th>
                    <th className="p-2 text-right">Sauda Basic</th>
                    <th className="p-2 text-right">Party Basic</th>
                    <th className="p-2">Changed</th>
                  </tr>
                </thead>
                <tbody>
                  {sRows.map((r) => {
                    const changed: string[] = [];
                    if (r.prev) {
                      if (Number(r.prev.adder) !== Number(r.adder)) changed.push("adder");
                      if (Number(r.prev.sauda_basic) !== Number(r.sauda_basic)) changed.push("sauda");
                      if (Number(r.prev.party_basic) !== Number(r.party_basic)) changed.push("party");
                    }
                    return (
                      <tr key={r.id} className="border-b last:border-0">
                        <td className="p-2 whitespace-nowrap">{fmt(r.changed_at)}</td>
                        <td className="p-2 font-medium">{sMap.get(r.section_id) ?? r.section_id}</td>
                        <td className="p-2 text-right font-mono">{Number(r.adder)}</td>
                        <td className="p-2 text-right font-mono">{Number(r.sauda_basic)}</td>
                        <td className="p-2 text-right font-mono">{Number(r.party_basic)}</td>
                        <td className="p-2">
                          {!r.prev ? <Badge variant="outline">initial</Badge>
                            : changed.length === 0 ? <Badge variant="outline">no change</Badge>
                            : changed.map((c) => <Badge key={c} className="mr-1" variant="secondary">{c}</Badge>)}
                        </td>
                      </tr>
                    );
                  })}
                  {!sRows.length && (
                    <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No history yet.</td></tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
