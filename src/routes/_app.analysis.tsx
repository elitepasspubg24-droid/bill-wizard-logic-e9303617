import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { fetchBills, fetchItems, fetchSections } from "@/lib/queries";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  Cell, Legend, AreaChart, Area
} from "recharts";
import { format, subDays, isWithinInterval, startOfDay, endOfDay, parseISO } from "date-fns";
import { 
  Package, TrendingUp, Trophy, ShoppingBag, Truck, Info, 
  ArrowUpDown, CalendarDays, Search, ListFilter
} from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_app/analysis")({
  component: AnalysisPage,
  head: () => ({ meta: [{ title: "Business Analysis" }] }),
});

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#0f172a"];

function AnalysisPage() {
  const bills = useQuery({ queryKey: ["bills"], queryFn: fetchBills });
  const items = useQuery({ queryKey: ["items"], queryFn: fetchItems });
  const sections = useQuery({ queryKey: ["sections"], queryFn: fetchSections });

  const [dateRange, setDateRange] = useState({
    start: format(subDays(new Date(), 30), "yyyy-MM-dd"),
    end: format(new Date(), "yyyy-MM-dd"),
  });
  const [searchQuery, setSearchQuery] = useState("");

  const analytics = useMemo(() => {
    if (!bills.data || !items.data || !sections.data) return null;

    const start = startOfDay(parseISO(dateRange.start));
    const end = endOfDay(parseISO(dateRange.end));

    const sectionMap = new Map(sections.data.map((s) => [s.id, s.name]));
    const itemMap = new Map(items.data.map((i) => [i.id, i]));

    // Aggregators
    let totalInwardMT = 0;
    let totalOutwardMT = 0;
    
    // 1. ALL ITEMS MOVEMENT (For the table)
    const movementByItem: Record<string, { name: string, section: string, inward: number, outward: number }> = {};
    // Initialize all items in movement record
    items.data.forEach(it => {
        movementByItem[it.id] = { 
            name: it.name, 
            section: sectionMap.get(it.section_id) || "Other",
            inward: 0, 
            outward: 0 
        };
    });

    // 2. DATE-WISE BREAKDOWN
    const dateWiseData: Record<string, { date: string, inward: number, outward: number, billCount: number }> = {};

    // Process all bills
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

    // 3. STOCK BY SECTION (Current Snapshot)
    const stockBySection: Record<string, number> = {};
    let grandTotalStock = 0;
    items.data.forEach((item) => {
      const sName = sectionMap.get(item.section_id) || "Other";
      const sQty = Number(item.available_qty) || 0;
      stockBySection[sName] = (stockBySection[sName] || 0) + sQty;
      grandTotalStock += sQty;
    });

    // Sort movement items to get Top 5
    const allMovementArray = Object.values(movementByItem);
    const topSellingItems = [...allMovementArray].sort((a, b) => b.outward - a.outward).slice(0, 5);
    const topPurchasedItems = [...allMovementArray].sort((a, b) => b.inward - a.inward).slice(0, 5);

    return {
      totalInwardMT,
      totalOutwardMT,
      grandTotalStock,
      chartData: Object.values(dateWiseData).sort((a, b) => a.date.localeCompare(b.date)),
      stockChartData: Object.entries(stockBySection).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
      topSellingItems,
      topPurchasedItems,
      allMovement: allMovementArray,
      dateWiseReport: Object.values(dateWiseData).sort((a, b) => b.date.localeCompare(a.date))
    };
  }, [bills.data, items.data, sections.data, dateRange]);

  if (!analytics) return <div className="p-8 text-center">Calculating data...</div>;

  const filteredMovement = analytics.allMovement.filter(it => 
    it.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    it.section.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6 pb-12">
      {/* Universal Header with Date Filter */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b pb-4">
        <div>
          <h2 className="text-2xl font-black flex items-center gap-2">
            <ArrowUpDown className="text-primary h-6 w-6" /> Performance Analysis
          </h2>
          <p className="text-sm text-muted-foreground">Period: {format(parseISO(dateRange.start), "dd MMM")} — {format(parseISO(dateRange.end), "dd MMM yyyy")}</p>
        </div>
        <div className="flex items-center gap-2 bg-card border p-2 rounded-xl shadow-sm">
          <div className="grid gap-0.5">
            <span className="text-[9px] uppercase font-bold text-muted-foreground px-1">From Date</span>
            <Input type="date" value={dateRange.start} onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))} className="h-8 border-none focus-visible:ring-0 w-36 text-xs bg-transparent" />
          </div>
          <div className="w-px h-8 bg-border" />
          <div className="grid gap-0.5">
            <span className="text-[9px] uppercase font-bold text-muted-foreground px-1">To Date</span>
            <Input type="date" value={dateRange.end} onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))} className="h-8 border-none focus-visible:ring-0 w-36 text-xs bg-transparent" />
          </div>
        </div>
      </div>

      <Tabs defaultValue="dashboard" className="w-full">
        <TabsList className="grid grid-cols-3 w-full max-w-md mb-6">
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="items">All Items</TabsTrigger>
          <TabsTrigger value="dates">Date-wise</TabsTrigger>
        </TabsList>

        {/* ─── TAB 1: DASHBOARD ────────────────────────────────────────── */}
        <TabsContent value="dashboard" className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <KPICard title="Period Inward" value={`${analytics.totalInwardMT.toFixed(2)} MT`} icon={<Truck className="text-emerald-500" />} desc="Total stock received" />
            <KPICard title="Period Outward" value={`${analytics.totalOutwardMT.toFixed(2)} MT`} icon={<ShoppingBag className="text-blue-500" />} desc="Total sales volume" />
            <KPICard title="Live Inventory" value={`${analytics.grandTotalStock.toFixed(2)} MT`} icon={<Package className="text-slate-900" />} desc="Current physical stock" />
            <KPICard title="Active Sections" value={analytics.stockChartData.length.toString()} icon={<ListFilter className="text-amber-500" />} desc="Product groups in stock" />
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            {/* Top Sellers (Preview) */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <Trophy className="h-4 w-4 text-amber-500" /> Top Selling Items
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {analytics.topSellingItems.map((item, i) => (
                  <div key={i} className="space-y-1.5">
                    <div className="flex justify-between text-xs font-medium">
                      <span className="truncate">{item.name} <span className="text-[10px] text-muted-foreground font-normal">({item.section})</span></span>
                      <span className="font-mono font-bold">{item.outward.toFixed(2)} MT</span>
                    </div>
                    <Progress value={analytics.totalOutwardMT > 0 ? (item.outward / analytics.totalOutwardMT) * 100 * 5 : 0} className="h-1.5" />
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Movement Area Chart */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Volume Trends (MT)</CardTitle>
              </CardHeader>
              <CardContent className="h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={analytics.chartData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="date" hide />
                    <Tooltip labelFormatter={(d) => format(parseISO(d), "dd MMM")} />
                    <Area type="monotone" dataKey="inward" name="Inward" stroke="#10b981" fill="#10b981" fillOpacity={0.1} />
                    <Area type="monotone" dataKey="outward" name="Outward" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.1} />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          {/* Section Distribution */}
          <Card>
            <CardHeader>
              <CardTitle>Stock Distribution by Section</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
               <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-muted/50 border-b text-muted-foreground uppercase text-[10px] font-bold">
                    <tr>
                      <th className="px-6 py-3">Section</th>
                      <th className="px-6 py-3 text-right">Current Weight</th>
                      <th className="px-6 py-3 text-right">Distribution</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {analytics.stockChartData.map((item, i) => (
                      <tr key={i} className="hover:bg-muted/30 transition-colors group">
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
                    <tr className="bg-slate-50 font-black border-t-2">
                      <td className="px-6 py-4">GRAND TOTAL UNITS</td>
                      <td className="px-6 py-4 text-right font-mono text-primary text-base">{analytics.grandTotalStock.toFixed(2)} MT</td>
                      <td className="px-6 py-4 text-right">100%</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── TAB 2: ALL ITEMS MOVEMENT ────────────────────────────────── */}
        <TabsContent value="items" className="space-y-4">
          <div className="flex items-center gap-2 mb-4">
            <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input 
                    placeholder="Search by item or section..." 
                    className="pl-9 h-9" 
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                />
            </div>
            <Badge variant="outline" className="h-9 px-3 rounded-md">{filteredMovement.length} Items found</Badge>
          </div>

          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left border-collapse">
                  <thead className="bg-muted/50 border-b text-[10px] uppercase font-bold text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3">Product Description</th>
                      <th className="px-4 py-3">Section</th>
                      <th className="px-4 py-3 text-right text-emerald-600 bg-emerald-50/30">Total Inward</th>
                      <th className="px-4 py-3 text-right text-blue-600 bg-blue-50/30">Total Outward</th>
                      <th className="px-4 py-3 text-right">Net Change</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filteredMovement.map((it, idx) => (
                      <tr key={idx} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 font-semibold">{it.name}</td>
                        <td className="px-4 py-3 text-muted-foreground">{it.section}</td>
                        <td className="px-4 py-3 text-right font-mono font-medium text-emerald-600">+{it.inward.toFixed(2)}</td>
                        <td className="px-4 py-3 text-right font-mono font-medium text-blue-600">-{it.outward.toFixed(2)}</td>
                        <td className="px-4 py-3 text-right font-mono font-bold">
                            {(it.inward - it.outward).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                    {filteredMovement.length === 0 && (
                        <tr><td colSpan={5} className="p-12 text-center text-muted-foreground">No matching item records found for this period.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── TAB 3: DATE-WISE SALES ────────────────────────────────────── */}
        <TabsContent value="dates" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                    <CalendarDays className="h-4 w-4 text-primary" /> Daily Transaction Journal
                </CardTitle>
                <CardDescription>Summary of daily stock activity (In/Out MT)</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-muted/50 border-b text-[10px] uppercase font-bold text-muted-foreground">
                    <tr>
                      <th className="px-6 py-3">Transaction Date</th>
                      <th className="px-6 py-3">Total Bills</th>
                      <th className="px-6 py-3 text-right">Daily Inward (MT)</th>
                      <th className="px-6 py-3 text-right">Daily Outward (MT)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {analytics.dateWiseReport.map((day, idx) => (
                      <tr key={idx} className="hover:bg-muted/30 transition-colors">
                        <td className="px-6 py-4 font-bold">{format(parseISO(day.date), "eeee, dd MMM yyyy")}</td>
                        <td className="px-6 py-4">
                            <Badge variant="secondary">{day.billCount} bills</Badge>
                        </td>
                        <td className="px-6 py-4 text-right font-mono text-emerald-600">+{day.inward.toFixed(2)}</td>
                        <td className="px-6 py-4 text-right font-mono text-blue-600">-{day.outward.toFixed(2)}</td>
                      </tr>
                    ))}
                    {analytics.dateWiseReport.length === 0 && (
                        <tr><td colSpan={4} className="p-12 text-center text-muted-foreground">No transactions recorded for the selected date range.</td></tr>
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

function KPICard({ title, value, icon, desc }: { title: string, value: string, icon: React.ReactNode, desc: string }) {
  return (
    <Card className="rounded-2xl border-slate-200">
      <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
        <CardTitle className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{title}</CardTitle>
        <div className="p-2 bg-muted/50 rounded-lg">{icon}</div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-black tabular-nums">{value}</div>
        <p className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1 font-medium">
          <Info className="h-3 w-3" /> {desc}
        </p>
      </CardContent>
    </Card>
  );
}
