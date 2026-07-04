import { useState, useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Percent, PercentCircle, Settings2, Check } from "lucide-react";

export const Route = createFileRoute("/_app/")({
  component: DashboardIndex,
});

function DashboardIndex() {
  const { toast } = useToast();

  // Load existing values from localStorage or default to initial values
  const [partyAdder, setPartyAdder] = useState<string>(() => localStorage.getItem("party_adder") || "");
  const [factoryAdder, setFactoryAdder] = useState<string>(() => localStorage.getItem("factory_adder") || "");
  const [wPercentage, setWPercentage] = useState<string>(() => localStorage.getItem("w_percentage") || "");

  // Sync input values to local state persistence layers
  useEffect(() => {
    localStorage.setItem("party_adder", partyAdder);
  }, [partyAdder]);

  useEffect(() => {
    localStorage.setItem("factory_adder", factoryAdder);
  }, [factoryAdder]);

  useEffect(() => {
    localStorage.setItem("w_percentage", wPercentage);
  }, [wPercentage]);

  // Bulk Apply Logic for standard Party Adder
  const handleApplyPartyAll = () => {
    if (!partyAdder) {
      toast({
        title: "Configuration Error",
        description: "Please enter a Party Adder amount first.",
        variant: "destructive",
      });
      return;
    }
    
    const items = JSON.parse(localStorage.getItem("items_list") || "[]");
    const updatedItems = items.map((item: any) => ({
      ...item,
      party_adder: parseFloat(partyAdder) || 0,
    }));
    localStorage.setItem("items_list", JSON.stringify(updatedItems));
    
    toast({
      title: "Success",
      description: `Applied Party Adder of ₹${partyAdder} across all catalog entries!`,
    });
  };

  // New Bulk Apply Logic for Percentage Adder "w"
  const handleApplyWAll = () => {
    if (!wPercentage) {
      toast({
        title: "Configuration Error",
        description: "Please enter a percentage value for 'w' first.",
        variant: "destructive",
      });
      return;
    }

    const items = JSON.parse(localStorage.getItem("items_list") || "[]");
    const updatedItems = items.map((item: any) => ({
      ...item,
      w_percentage: parseFloat(wPercentage) || 0,
    }));
    localStorage.setItem("items_list", JSON.stringify(updatedItems));

    toast({
      title: "Modifier Applied",
      description: `Applied Percentage Adder "w" of ${wPercentage}% across all catalog entries!`,
    });
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Top Header Row with Bulk Apply Actions */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b pb-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Adder Configurations</h1>
          <p className="text-muted-foreground">Manage your margins, factory rates, and weight indices adjustments.</p>
        </div>
        
        {/* Dynamic Apply Action Bar on Top Right */}
        <div className="flex flex-wrap items-center gap-3 bg-secondary/40 p-2 rounded-lg border">
          <Button 
            onClick={handleApplyPartyAll}
            size="sm"
            variant="outline"
            className="h-9"
          >
            Apply Party All
          </Button>
          
          <Button 
            onClick={handleApplyWAll}
            size="sm"
            className="h-9 bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-1.5"
          >
            <Check className="h-4 w-4" />
            Apply All (w)
          </Button>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center space-x-3 space-y-0 pb-4 border-b">
            <Settings2 className="h-5 w-5 text-blue-500" />
            <CardTitle className="text-xl">Global Adders Parameters</CardTitle>
          </CardHeader>
          <CardContent className="pt-6 space-y-5">
            {/* Party Adder Field */}
            <div className="space-y-2">
              <label className="text-sm font-semibold tracking-wide block text-foreground/80">
                Party Adder
              </label>
              <Input
                type="number"
                placeholder="Enter baseline party adder margin"
                value={partyAdder}
                onChange={(e) => setPartyAdder(e.target.value)}
                className="w-full"
              />
            </div>

            {/* Factory Adder Field */}
            <div className="space-y-2">
              <label className="text-sm font-semibold tracking-wide block text-foreground/80">
                Factory Adder
              </label>
              <Input
                type="number"
                placeholder="Enter base factory value"
                value={factoryAdder}
                onChange={(e) => setFactoryAdder(e.target.value)}
                className="w-full"
              />
            </div>

            {/* Percentage Adder "w" Input Element - Placed right after Factory Adder */}
            <div className="space-y-2">
              <label className="text-sm font-semibold tracking-wide block text-foreground/80 flex items-center gap-1.5">
                Percentage Adder <span className="text-blue-500 font-bold">("w")</span>
              </label>
              <div className="relative">
                <Input
                  type="number"
                  placeholder="e.g. 10 or 11 or 12"
                  value={wPercentage}
                  onChange={(e) => setWPercentage(e.target.value)}
                  className="w-full pr-10"
                />
                <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-muted-foreground">
                  <Percent className="h-4 w-4" />
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Applies compounding premium weight calculation directly to the designated factory pricing tier.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Live Calculation Metric Box Card Preview */}
        <Card className="shadow-sm bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-950">
          <CardHeader>
            <CardTitle className="text-lg font-medium flex items-center gap-2">
              <PercentCircle className="h-5 w-5 text-green-500" />
              Formula Logic Sandbox Preview
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <p className="text-muted-foreground">
              Real-time calculation metrics using your active formula variables configuration sheet values.
            </p>
            <div className="p-4 rounded-md border bg-background space-y-2 font-mono text-xs">
              <div className="flex justify-between">
                <span>Base Factory Rate:</span>
                <span className="font-semibold text-foreground">₹{parseFloat(factoryAdder || "0").toFixed(2)}</span>
              </div>
              <div className="flex justify-between border-b pb-2">
                <span>Weight Modifier (w):</span>
                <span className="font-semibold text-blue-500">+{wPercentage || "0"}%</span>
              </div>
              <div className="flex justify-between pt-1 text-sm font-bold text-green-600">
                <span>Resulting Today's Rate:</span>
                <span>
                  ₹{(
                    (parseFloat(factoryAdder) || 0) + 
                    ((parseFloat(factoryAdder) || 0) * (parseFloat(wPercentage) || 0) / 100)
                  ).toFixed(2)}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
