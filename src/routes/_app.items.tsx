import { useState, useEffect, useRef } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, Layers, RefreshCw, ShoppingCart, Download, Trash2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";

export const Route = createFileRoute("/_app/items")({
  component: ItemsPage,
});

const INITIAL_DEMO_ITEMS = [
  { id: "1", name: "Structural Steel Angle", code: "ST-ANG-01", factory_adder: 45000, party_adder: 1200, w_percentage: 0 },
  { id: "2", name: "Steel Flat Bar", code: "ST-FLAT-02", factory_adder: 48000, party_adder: 1500, w_percentage: 0 },
  { id: "3", name: "Round Bar Section", code: "ST-RND-03", factory_adder: 51000, party_adder: 1100, w_percentage: 0 },
];

function ItemsPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [items, setItems] = useState<any[]>([]);
  const [cart, setCart] = useState<any[]>([]);
  const cartRef = useRef<HTMLDivElement>(null);

  const [globalFactoryAdder, setGlobalFactoryAdder] = useState<number>(0);
  const [globalWPercentage, setGlobalWPercentage] = useState<number>(0);

  useEffect(() => {
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

  const calculateTodaysRate = (itemFactoryAdder: number, itemWPercentage: number) => {
    const baseFactoryValue = itemFactoryAdder || globalFactoryAdder;
    const activeWPercent = itemWPercentage !== undefined && itemWPercentage !== 0 ? itemWPercentage : globalWPercentage;
    const percentCompoundModifier = baseFactoryValue * (activeWPercent / 100);
    return baseFactoryValue + percentCompoundModifier;
  };

  const addToCart = (item: any) => {
    const computedRate = calculateTodaysRate(item.factory_adder, item.w_percentage);
    setCart((prev) => [...prev, { ...item, party_rate: computedRate }]);
  };

  const updateCartItemRate = (id: string, newRate: number) => {
    setCart((prev) => prev.map(item => item.id === id ? { ...item, party_rate: newRate } : item));
  };

  const removeFromCart = (id: string) => {
    setCart((prev) => prev.filter(item => item.id !== id));
  };

  const exportPDF = async () => {
    if (!cartRef.current) return;
    const canvas = await html2canvas(cartRef.current);
    const imgData = canvas.toDataURL("image/png");
    const pdf = new jsPDF("p", "mm", "a4");
    const imgProps = pdf.getImageProperties(imgData);
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
    pdf.addImage(imgData, "PNG", 0, 0, pdfWidth, pdfHeight);
    pdf.save("quotation.pdf");
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

        <div className="flex items-center gap-4">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline" className="gap-2">
                <ShoppingCart className="h-4 w-4" />
                View Cart ({cart.length})
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl">
              <DialogHeader>
                <DialogTitle>Quotation Cart</DialogTitle>
              </DialogHeader>
              <div ref={cartRef} className="p-4 bg-white dark:bg-background border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead>Party Rate (Editable)</TableHead>
                      <TableHead className="w-16"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cart.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>{item.name}</TableCell>
                        <TableCell>
                          <Input 
                            type="number" 
                            className="w-32"
                            value={item.party_rate} 
                            onChange={(e) => updateCartItemRate(item.id, parseFloat(e.target.value))}
                          />
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon" onClick={() => removeFromCart(item.id)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <Button onClick={exportPDF} className="w-full gap-2">
                <Download className="h-4 w-4" /> Export as PDF
              </Button>
            </DialogContent>
          </Dialog>
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
                  <TableHead className="font-semibold text-right text-foreground">Today's Rate</TableHead>
                  <TableHead className="font-semibold text-center text-foreground">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredItems.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                      No materials matching catalog search filters found.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredItems.map((item) => {
                    const computedTodaysRate = calculateTodaysRate(item.factory_adder, item.w_percentage);
                    return (
                      <TableRow key={item.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-900/40 transition-colors">
                        <TableCell className="font-mono text-xs text-muted-foreground">{item.code}</TableCell>
                        <TableCell className="font-medium text-foreground">{item.name}</TableCell>
                        <TableCell className="text-right font-mono font-bold text-green-600 dark:text-green-400 text-base">
                          ₹{computedTodaysRate.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="text-center">
                          <Button size="sm" variant="outline" onClick={() => addToCart(item)} className="gap-1">
                            <Plus className="h-3.5 w-3.5" /> Add
                          </Button>
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
