import { useState, useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, Layers, RefreshCw } from "lucide-react";

export const Route = createFileRoute("/_app/items")({
  component: ItemsPage,
});

// Safe initial dataset fallback matrix structure
const INITIAL_DEMO_ITEMS = [
  { id: "1", name: "Structural Steel Angle", code: "ST-ANG-01", factory_adder: 45000, party_adder: 1200, w_percentage: 10 },
  { id: "2", name: "Steel Flat Bar", code: "ST-FLAT-02", factory_adder: 48000, party_adder: 1500, w_percentage: 12 },
  { id: "3", name: "Round Bar Section", code: "ST-RND-03", factory_adder: 51000, party_adder: 1100, w_percentage: 0 },
];

function ItemsPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [items, setItems] = useState<any[]>([]);

  // Track global state fallbacks synced from dashboard inputs
  const [globalFactoryAdder, setGlobalFactoryAdder] = useState<number>(0);
  const [globalWPercentage, setGlobalWPercentage] = useState<number>(0);

  useEffect(() => {
    // Collect active values assigned inside context index state scope
    const storedFactory = localStorage.getItem("factory_adder");
    const storedW = localStorage.getItem("w_percentage");
    
    if (storedFactory) setGlobalFactoryAdder(parseFloat(storedFactory) || 0);
    if (storedW) setGlobalWPercentage(parseFloat(storedW) || 0);

    const storedItems = localStorage.getItem("items_list");
    if (storedItems) {
      setItems(JSON.parse(storedItems));
    } else {
      localStorage.setItem("items_list", JSON.stringify(INITIAL_DEMO_ITEMS));
      setItems(INITIAL_DEMO_ITEMS);
    }
  }, []);

  // Mathematical Calculation Logic Core: factory adder + (factory adder * w / 100) = Today's Rate
  const calculateTodaysRate = (itemFactoryAdder?: number, itemWPercentage?: number) => {
    const baseFactoryValue = itemFactoryAdder !== undefined && itemFactoryAdder !== null ? itemFactoryAdder : globalFactoryAdder;
    const activeWPercent = itemWPercentage !== undefined && itemWPercentage !== null ? itemWPercentage : globalWPercentage;
    
    // Calculates % markup added back onto baseline values directly
    const percentCompoundModifier = baseFactoryValue * (activeWPercent / 100);
    return baseFactoryValue + percentCompoundModifier;
  };

  const filteredItems = items.filter(
    (item) =>
      item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.code.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Items Catalog</h1>
          <p className="text-muted-foreground">Track inventory classifications and live calculations matching global coefficients.</p>
        </div>

        <div className="flex items-center gap-2 text-xs bg-slate-100 dark:bg-slate-800 p-2 rounded-md border border-dashed">
          <RefreshCw className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          <span>Formulations automatically updated using active configuration settings.</span>
        </div>
      </div>

      <Card className="shadow-sm">
        <CardHeader className="pb-3 border-b">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <CardTitle className="text-lg font-medium flex items-center gap-2">
              <Layers className="h-5 w-5 text-indigo-500" />
              Inventory Metrics Valuation Matrix
            </CardTitle>
            
            <div className="relative w-full md:w-72">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Filter by description or index tag..."
                className="pl-9 w-full"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-slate-50 dark:bg-slate-900">
                <TableRow>
                  <TableHead className="font-semibold text-foreground">Code Index</TableHead>
                  <TableHead className="font-semibold text-foreground">Item Description</TableHead>
                  <TableHead className="font-semibold text-right text-foreground">Base Factory</TableHead>
                  <TableHead className="font-semibold text-right text-blue-600 dark:text-blue-400">% Adder (w)</TableHead>
                  <TableHead className="font-semibold text-right text-foreground">Party Adder</TableHead>
                  <TableHead className="font-semibold text-right text-green-600 dark:text-green-400">Today's Rate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredItems.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                      No materials matching catalog search filters found.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredItems.map((item) => {
                    const activeFactoryRate = item.factory_adder !== undefined ? item.factory_adder : globalFactoryAdder;
                    const activePercentageW = item.w_percentage !== undefined && item.w_percentage !== null ? item.w_percentage : globalWPercentage;
                    const activePartyAdder = item.party_adder || 0;
                    const computedTodaysRate = calculateTodaysRate(item.factory_adder, item.w_percentage);

                    return (
                      <TableRow key={item.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-900/40 transition-colors">
                        <TableCell className="font-mono text-xs text-muted-foreground">{item.code}</TableCell>
                        <TableCell className="font-medium text-foreground">{item.name}</TableCell>
                        <TableCell className="text-right font-mono">
                          ₹{activeFactoryRate.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="text-right font-mono text-blue-600 dark:text-blue-400 font-medium">
                          <Badge variant="secondary" className="font-sans text-xs bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-900">
                            {activePercentageW}%
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          ₹{activePartyAdder.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="text-right font-mono font-bold text-green-600 dark:text-green-400 text-base">
                          ₹{computedTodaysRate.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
