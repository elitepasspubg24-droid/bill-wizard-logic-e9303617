import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { fetchBills, fetchItems, fetchSections, fetchSaudas } from "@/lib/queries";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  PieChart, Pie, Cell, Legend, LineChart, Line 
} from "recharts";
import { format, subDays, isWithinInterval, startOfDay, endOfDay, parseISO } from "date-fns";
import { ArrowUpToLine, ArrowDownToLine, Package, Calculator, TrendingUp } from "lucide-react";

export const Route = createFileRoute("/_app/analysis")({
  component: AnalysisPage,
  head: () => ({ meta: [{ title: "Business Analysis" }] }),
});

const COLORS = ["#0f172a", "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"];

function AnalysisPage() {
  const bills = useQuery({ queryKey: ["bills"], queryFn: fetchBills });
  const items = useQuery({ queryKey: ["items"], queryFn: fetchItems });
  const sections = useQuery({ queryKey: ["sections"], queryFn: fetchSections });
  const saudas = useQuery({ queryKey: ["saudas"], queryFn: fetchSaudas });

  const [dateRange, setDateRange] = useState({
    start: format(subDays(new Date(), 30), "yyyy-MM-dd"),
    end: format(new Date(), "yyyy-MM-dd"),
  });

  const stats = useMemo(() => {
    if (!bills.data || !items.data || !sections.data) return null;

    const start = startOfDay(parseISO(dateRange.start));
    const end = endOfDay(parseISO(dateRange.end));

    // 1. Inward/Outward Analysis
    let totalInward = 0;
    let totalOutward = 0;
    const dailyData: Record<string, { date: string; inward: number; outward: number }> = {};

    bills.data.forEach((bill) => {
      const bDate = parseISO(bill.bill_date || bill.created_at);
      const isMatch = isWithinInterval(bDate, { start, end });
      const dStr = format(bDate, "MMM dd");

      if (!dailyData[dStr]) dailyData[dStr] = { date: dStr, inward: 0, outward: 0 };

      bill.bill_items?.forEach((bi: any) => {
        const qty = Number(bi.qty) || 0;
        if (bill.type === "purchase") {
          if (isMatch) totalInward += qty;
          dailyData[dStr].inward += qty;
        } else {
          if (isMatch) totalOutward += qty;
          dailyData[dStr].outward += qty;
        }
      });
    });

    // 2. Stock Analysis by Section
    const sectionMap = new Map(sections.data.map((s) => [s.id, s.name]));
    const stockBySection: Record<string, number> = {};
    let grandTotalStock = 0;

    items.data.forEach((item) => {
      const sName = sectionMap.get(item.section_id) || "Other";
      const sQty = Number(item.available_qty) || 0;
      stockBySection[sName] = (stockBySection[sName] || 0) + sQty;
      grandTotalStock += sQty;
    });

    const stockChartData = Object.entries(stockBySection)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    // 3. Sauda Fulfillment
    let totalSaudaQty = 0;
    let totalLiftedQty = 0;
    saudas.data?.forEach(s => {
      if (s.status !== 'done') {
        totalSaudaQty += Number(s.total_qty || 0);
        totalLiftedQty += Number(s.lifted_qty || 0);
      }
    });

    return {
      totalInward,
      totalOutward,
      grandTotalStock,
      chartData: Object.values(dailyData).slice(-15), // Show last 15 active days
      stockChartData,
      saudaProgress: totalSaudaQty > 0 ? (totalLiftedQty / totalSaudaQty) * 100 : 0,
      totalPendingSauda: Math.max(0, totalSaudaQty - totalLiftedQty)
    };
  }, [bills.data, items.data, sections.data, saudas.data, dateRange]);

  if (!stats) return <div className="p-8 text-center">Calculating analysis...</div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">Business Analysis</h2>
          <p className="text-sm text-muted-foreground">Overview of movement, inventory, and fulfillment.</p>
        </div>
        <div className="flex items-center gap-2 bg-card border p-2 rounded-lg shadow-sm">
          <div className="grid gap-1">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground">From</Label>
            <Input type="date" value={dateRange.start} onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))} className="h-8 w-36 text-xs" />
          </div>
          <div className="grid gap-1">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground">To</Label>
            <Input type="date" value={dateRange.end} onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))} className="h-8 w-36 text-xs" />
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Inward (Period)</CardTitle>
            <ArrowUpToLine className="w-4 h-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalInward.toFixed(2)} MT</div>
            <p className="text-xs text-muted-foreground mt-1">Total purchased stock</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Outward (Period)</CardTitle>
            <ArrowDownToLine className="w-4 h-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalOutward.toFixed(2)} MT</div>
            <p className="text-xs text-muted-foreground mt-1">Total sales volume</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Current Inventory</CardTitle>
            <Package className="w-4 h-4 text-slate-900" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-primary">{stats.grandTotalStock.toFixed(2)} MT</div>
            <p className="text-xs text-muted-foreground mt-1">Sum of all sections</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Pending Saudas</CardTitle>
            <TrendingUp className="w-4 h-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalPendingSauda.toFixed(2)} MT</div>
            <div className="w-full bg-muted h-1 mt-2 rounded-full overflow-hidden">
              <div className="bg-amber-500 h-full" style={{ width: `${stats.saudaProgress}%` }} />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Movement Chart */}
        <Card>
          <CardHeader>
            <CardTitle>Stock Movement</CardTitle>
            <CardDescription>Inward vs Outward by day</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.chartData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}t`} />
                  <Tooltip 
                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                  />
                  <Legend verticalAlign="top" align="right" height={36}/>
                  <Bar dataKey="inward" name="Purchase" fill="#10b981" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="outward" name="Sale" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Stock Distribution Chart */}
        <Card>
          <CardHeader>
            <CardTitle>Inventory by Section</CardTitle>
            <CardDescription>Current weight distribution (MT)</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center">
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={stats.stockChartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {stats.stockChartData.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip tickFormatter={(v) => `${v} MT`} />
                  <Legend layout="vertical" verticalAlign="middle" align="right" />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Section-wise Table */}
      <Card>
        <CardHeader>
          <CardTitle>Stock Table</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-muted/50 border-b text-muted-foreground uppercase text-[10px] font-bold">
                <tr>
                  <th className="px-6 py-3">Section Name</th>
                  <th className="px-6 py-3 text-right">Current Stock (MT)</th>
                  <th className="px-6 py-3 text-right">% of Total</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {stats.stockChartData.map((item, i) => (
                  <tr key={i} className="hover:bg-muted/30 transition-colors">
                    <td className="px-6 py-4 font-medium">{item.name}</td>
                    <td className="px-6 py-4 text-right font-mono font-bold">{item.value.toFixed(2)} MT</td>
                    <td className="px-6 py-4 text-right text-muted-foreground">
                      {((item.value / stats.grandTotalStock) * 100).toFixed(1)}%
                    </td>
                  </tr>
                ))}
                <tr className="bg-slate-50 font-black">
                  <td className="px-6 py-4">FINAL TOTAL</td>
                  <td className="px-6 py-4 text-right font-mono text-primary">{stats.grandTotalStock.toFixed(2)} MT</td>
                  <td className="px-6 py-4 text-right">100%</td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
