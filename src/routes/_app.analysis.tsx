import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { fetchBills, fetchItems, fetchSections } from "@/lib/queries";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  AreaChart, Area
} from "recharts";
import { format, subDays, isWithinInterval, startOfDay, endOfDay, parseISO } from "date-fns";
import { 
  Package, Trophy, ShoppingBag, Truck, 
  ArrowUpDown, CalendarDays, Search, ListFilter,
  ArrowUpNarrowWide, ArrowDownNarrowWide, SortAsc
} from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/_app/analysis")({
  component: AnalysisPage,
  head: () => ({ meta: [{ title: "Business Analysis" }] }),
});

type SortKey = "name" | "section" | "inward" | "outward";

function AnalysisPage() {
  const bills = useQuery({ queryKey: ["bills"], queryFn: fetchBills });
  const items = useQuery({ queryKey: ["items"], queryFn: fetchItems });
  const sections = useQuery({ queryKey: ["sections"], queryFn: fetchSections });

  const [dateRange, setDateRange] = useState({
    start: format(subDays(new Date(), 30), "yyyy-MM-dd"),
    end: format(new Date(), "yyyy-MM-dd"),
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("outward");

  const analytics = useMemo(() => {
    if (!bills.data || !items.data || !sections.data) return null;

    const start = startOfDay(parseISO(dateRange.start));
    const end = endOfDay(parseISO(dateRange.end));

    const sectionMap = new Map(sections.data.map((s) => [s.id, s.name]));
    
    // Aggregators
    let totalInwardMT = 0;
    let totalOutwardMT = 0;
    
    const movementByItem: Record<string, { id: string, name: string, section: string, inward: number, outward: number }> = {};
    
    // Initialize movement record with all items
    items.data.forEach(it => {
        movementByItem[it.id] = { 
            id: it.id,
            name: it.name, 
            section: sectionMap.get(it.section_id) || "Other",
            inward: 0, 
            outward: 0 
        };
    });

    const dateWiseData: Record<string, { date: string, inward: number, outward: number, billCount: number }> = {};

    // Process all bills within range
    bills.data.forEach((bill) => {
      const bDate = parseISO(bill.bill_date || bill.created_at);
      const isInRange = isWithinInterval(bDate, { start, end });
      const dStr = format(bDate, "yyyy-MM-dd");

      if (isInRange) {
        if (!dateWiseData[dStr]) dateWiseData[dStr] = { date: dStr, inward: 0, outward: 0, billCount: 0 };
        dateWiseData[dStr].billCount += 1;

        bill.bill_items?.forEach((bi: any) => {
          const qty = Number(bi.qty) || 0;
          const itemId = bi.item_id;

          if (bill.type === "purchase") {
            totalInwardMT += qty;
            dateWiseData[dStr].inward += qty;
            if (itemId && movementByItem[itemId]) movementByItem[itemId].inward += qty;
          } else {
            totalOutwardMT += qty;
            dateWiseData[dStr].outward += qty;
            if (itemId && movementByItem[itemId]) movementByItem[itemId].outward += qty;
          }
        });
      }
    });

    // Stock distribution (Live Snapshot)
    const stockBySection: Record<string, number> = {};
    let grandTotalStock = 0;
    items.data.forEach((item) => {
      const sName = sectionMap.get(item.section_id) || "Other";
      const sQty = Number(item.available_qty) || 0;
      stockBySection[sName] = (stockBySection[sName] || 0) + sQty;
      grandTotalStock += sQty;
    });

    const allMovementArray = Object.values(movementByItem);
    const topSellers = [...allMovementArray].sort((a, b) => b.outward - a.outward).slice(0, 5);

    return {
      totalInwardMT,
      totalOutwardMT,
      grandTotalStock,
      chartData: Object.values(dateWiseData).sort((a, b) => a.date.localeCompare(b.date)),
      stockBreakdown: Object.entries(stockBySection).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
      topSellers,
      allMovement: allMovementArray,
      dateWiseReport: Object.values(dateWiseData).sort((a, b) => b.date.localeCompare(a.date))
    };
  }, [bills.data, items.data, sections.data, dateRange]);

  const sortedMovement = useMemo(() => {
    if (!analytics) return [];
    return [...analytics.allMovement]
      .filter(it => 
        it.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
        it.section.toLowerCase().includes(searchQuery.toLowerCase())
      )
      .sort((a, b) => {
        if (sortBy === "name") return a.name.localeCompare(b.name);
        if (sortBy === "section") return a.section.localeCompare(b.section);
        if (sortBy === "inward") return b.inward - a.inward;
        if (sortBy === "outward") return b.outward - a.outward;
        return 0;
      });
  }, [analytics, searchQuery, sortBy]);

  if (!analytics) return <div className="p-8 text-center text-muted-foreground">Analysing stock data...</div>;

  return (
    <div className="space-y-6 pb-16">
      {/* Date Filter Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">Business Analysis</h2>
          <p className="text-sm text-muted-foreground">Track stock flow and high-performance items.</p>
        </div>
        <div className="flex items-center gap-2 bg-card border rounded-lg p-1.5 shadow-sm">
          <Input type="date" value={dateRange.start} onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))} className="h-8 border-none focus-visible:ring-0 w-32 text-xs" />
          <span className="text-muted-foreground px-1">→</span>
          <Input type="date" value={dateRange.end} onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))} className="h-8 border-none focus-visible:ring-0 w-32 text-xs" />
        </div>
      </div>

      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="mb-6">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="all-items">All Items Movement</TabsTrigger>
          <TabsTrigger value="daily">Date-wise Report</TabsTrigger>
        </TabsList>

        {/* ─── TAB 1: OVERVIEW ─────────────────────────────────────────── */}
        <TabsContent value="overview" className="space-y-6">
          <div className="grid gap-4 md:grid-cols-3">
            <StatsCard title="Inward Weight" value={analytics.totalInwardMT} sub="Received in period" icon={<Truck className="text-emerald-600" />} />
            <StatsCard title="Outward Weight" value={analytics.totalOutwardMT} sub="Sold in period" icon={<ShoppingBag className="text-blue-600" />} />
            <StatsCard title="Live Stock" value={analytics.grandTotalStock} sub="Total units currently" icon={<Package className="text-slate-600" />} />
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader className="py-4">
                <CardTitle className="text-sm font-bold flex items-center gap-2 uppercase tracking-tight">
                  <Trophy className="h-4 w-4 text-amber-500" /> Top 5 Sellers (MT)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {analytics.topSellers.map((item, i) => (
                  <div key={i} className="space-y-1.5">
                    <div className="flex justify-between text-xs font-semibold">
                      <span>{item.name} <span className="text-[10px] text-muted-foreground font-normal">({item.section})</span></span>
                      <span className="font-mono text-primary">{item.outward.toFixed(2)} MT</span>
                    </div>
                    <Progress value={analytics.totalOutwardMT > 0 ? (item.outward / analytics.totalOutwardMT) * 100 * 3 : 0} className="h-1.5" />
                  </div>
                ))}
                {analytics.topSellers.length === 0 && <p className="text-xs text-center py-6 text-muted-foreground italic">No sales recorded.</p>}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="py-4">
                <CardTitle className="text-sm font-bold uppercase tracking-tight">Flow Trend (MT)</CardTitle>
              </CardHeader>
              <CardContent className="h-[200px] p-2">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={analytics.chartData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="date" hide />
                    <Tooltip labelFormatter={(d) => format(parseISO(d), "dd MMM")} />
                    <Area type="monotone" dataKey="inward" name="Inward" stroke="#10b981" fill="#10b981" fillOpacity={0.05} />
                    <Area type="monotone" dataKey="outward" name="Outward" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.05} />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="border-b bg-muted/20 py-3">
               <CardTitle className="text-sm font-bold uppercase tracking-wide">Stock Distribution By Section</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-sm text-left">
                <thead className="text-[10px] uppercase font-bold text-muted-foreground bg-muted/30">
                  <tr>
                    <th className="px-6 py-3">Section Group</th>
                    <th className="px-6 py-3 text-right">Physical Stock (MT)</th>
                    <th className="px-6 py-3 text-right">Share</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {analytics.stockBreakdown.map((item, i) => (
                    <tr key={i} className="hover:bg-muted/30">
                      <td className="px-6 py-4 font-medium">{item.name}</td>
                      <td className="px-6 py-4 text-right font-mono font-bold">{item.value.toFixed(2)} MT</td>
                      <td className="px-6 py-4 text-right">
                         <div className="flex items-center justify-end gap-2">
                           <span className="text-[10px] text-muted-foreground">{((item.value / analytics.grandTotalStock) * 100).toFixed(1)}%</span>
                           <Progress value={(item.value / analytics.grandTotalStock) * 100} className="w-16 h-1" />
                         </div>
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-slate-50 font-black border-t-2 text-primary">
                    <td className="px-6 py-4">FINAL TOTAL UNITS</td>
                    <td className="px-6 py-4 text-right font-mono text-base">{analytics.grandTotalStock.toFixed(2)} MT</td>
                    <td className="px-6 py-4 text-right">100%</td>
                  </tr>
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── TAB 2: ALL ITEMS MOVEMENT ───────────────────────────────── */}
        <TabsContent value="all-items" className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3 items-end sm:items-center justify-between bg-card border p-3 rounded-lg shadow-sm">
            <div className="relative flex-1 w-full max-w-sm">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input 
                    placeholder="Filter by name/section..." 
                    className="pl-9 h-9" 
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                />
            </div>
            
            <div className="flex items-center gap-2 w-full sm:w-auto">
               <Label className="text-xs whitespace-nowrap text-muted-foreground font-bold uppercase">Sort By:</Label>
               <Select value={sortBy} onValueChange={(v: any) => setSortBy(v)}>
                  <SelectTrigger className="h-9 w-full sm:w-44 bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="outward" className="text-xs"><div className="flex items-center gap-2"><ArrowDownNarrowWide className="h-3 w-3" /> Most Selling</div></SelectItem>
                    <SelectItem value="inward" className="text-xs"><div className="flex items-center gap-2"><ArrowUpNarrowWide className="h-3 w-3" /> Most Purchased</div></SelectItem>
                    <SelectItem value="name" className="text-xs"><div className="flex items-center gap-2"><SortAsc className="h-3 w-3" /> Alphabetical</div></SelectItem>
                    <SelectItem value="section" className="text-xs"><div className="flex items-center gap-2"><ListFilter className="h-3 w-3" /> Section</div></SelectItem>
                  </SelectContent>
               </Select>
            </div>
          </div>

          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left border-collapse">
                  <thead className="bg-muted/50 border-b text-[10px] uppercase font-bold text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3">Item Description</th>
                      <th className="px-4 py-3">Section</th>
                      <th className="px-4 py-3 text-right text-emerald-600 bg-emerald-50/20">Total Inward</th>
                      <th className="px-4 py-3 text-right text-blue-600 bg-blue-50/20">Total Outward</th>
                      <th className="px-4 py-3 text-right">Net Flow</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {sortedMovement.map((it, idx) => (
                      <tr key={it.id} className="hover:bg-muted/30">
                        <td className="px-4 py-3 font-semibold">{it.name}</td>
                        <td className="px-4 py-3 text-[11px] text-muted-foreground font-medium uppercase tracking-tight">{it.section}</td>
                        <td className="px-4 py-3 text-right font-mono font-medium text-emerald-600">+{it.inward.toFixed(2)}</td>
                        <td className="px-4 py-3 text-right font-mono font-medium text-blue-600">-{it.outward.toFixed(2)}</td>
                        <td className="px-4 py-3 text-right font-mono font-bold">
                            {(it.inward - it.outward).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                    {sortedMovement.length === 0 && (
                        <tr><td colSpan={5} className="p-12 text-center text-muted-foreground italic">No matching movement data found.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── TAB 3: DATE-WISE REPORT ──────────────────────────────────── */}
        <TabsContent value="daily" className="space-y-4">
          <Card>
            <CardHeader className="bg-muted/20 border-b py-3">
                <CardTitle className="text-sm font-bold flex items-center gap-2 uppercase tracking-wide">
                    <CalendarDays className="h-4 w-4 text-primary" /> Daily Transaction Journal
                </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="text-[10px] uppercase font-bold text-muted-foreground bg-muted/10 border-b">
                    <tr>
                      <th className="px-6 py-3">Date</th>
                      <th className="px-6 py-3">Activity</th>
                      <th className="px-6 py-3 text-right">Daily In (MT)</th>
                      <th className="px-6 py-3 text-right">Daily Out (MT)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {analytics.dateWiseReport.map((day, idx) => (
                      <tr key={day.date} className="hover:bg-muted/30">
                        <td className="px-6 py-4 font-bold">{format(parseISO(day.date), "eeee, dd MMM yyyy")}</td>
                        <td className="px-6 py-4">
                            <Badge variant="secondary" className="font-medium">{day.billCount} bills</Badge>
                        </td>
                        <td className="px-6 py-4 text-right font-mono text-emerald-600 font-medium">+{day.inward.toFixed(2)}</td>
                        <td className="px-6 py-4 text-right font-mono text-blue-600 font-medium">-{day.outward.toFixed(2)}</td>
                      </tr>
                    ))}
                    {analytics.dateWiseReport.length === 0 && (
                        <tr><td colSpan={4} className="p-12 text-center text-muted-foreground italic">No activity for this date range.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StatsCard({ title, value, sub, icon }: { title: string, value: number, sub: string, icon: React.ReactNode }) {
  return (
    <Card className="shadow-sm border-slate-200">
      <CardHeader className="flex flex-row items-center justify-between pb-1 space-y-0">
        <CardTitle className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{title}</CardTitle>
        <div className="p-2 bg-muted/40 rounded-lg">{icon}</div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-black tabular-nums">{value.toFixed(2)} <span className="text-xs font-normal text-muted-foreground uppercase">MT</span></div>
        <p className="text-[10px] text-muted-foreground font-medium mt-1">{sub}</p>
      </CardContent>
    </Card>
  );
}
