import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, Package, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner"; // Using your sonner toast configuration
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// 1. Interface definitions
interface Item {
  id: string;
  name: string;
  price: number;
  section: string;
}

export const Route = createFileRoute("/_app/items")({
  component: ItemsComponent,
});

function ItemsComponent() {
  // Mock local state (Replace with your Supabase useQuery data or local arrays)
  const [items, setItems] = useState<Item[]>([
    { id: "1", name: "Premium Wheat", price: 2400, section: "Grains" },
    { id: "2", name: "Basmati Rice", price: 6500, section: "Grains" },
    { id: "3", name: "Refined Oil", price: 1500, section: "Oils" },
  ]);

  // Derived state for existing unique sections
  const sections = Array.from(new Set(items.map((item) => item.section)));

  // Form & Dialog UI state
  const [isOpen, setIsOpen] = useState(false);
  const [newItemName, setNewItemName] = useState("");
  const [newItemPrice, setNewItemPrice] = useState("");
  const [selectedSection, setSelectedSection] = useState("");
  const [customSection, setCustomSection] = useState("");

  // 2. Handler function to add an item to any section
  const handleAddItem = (e: React.FormEvent) => {
    e.preventDefault();

    // Validations
    if (!newItemName.trim()) {
      toast.error("Please enter an item name");
      return;
    }

    const priceNum = parseFloat(newItemPrice);
    if (isNaN(priceNum) || priceNum <= 0) {
      toast.error("Please enter a valid price");
      return;
    }

    // Determine target section name
    const finalSection = selectedSection === "new" ? customSection.trim() : selectedSection;
    if (!finalSection) {
      toast.error("Please select or enter a section");
      return;
    }

    const newItem: Item = {
      id: crypto.randomUUID(), // Fallback local ID generation
      name: newItemName.trim(),
      price: priceNum,
      section: finalSection,
    };

    /** 
     * NOTE FOR SUPABASE: If updating your database, swap this state logic with:
     * const { error } = await supabase.from('items').insert([{ name: newItem.name, price: newItem.price, section: newItem.section }])
     */
    setItems((prev) => [...prev, newItem]);
    toast.success(`"${newItemName}" successfully added to ${finalSection}!`);

    // Reset Form fields and close Modal
    setNewItemName("");
    setNewItemPrice("");
    setSelectedSection("");
    setCustomSection("");
    setIsOpen(false);
  };

  // 3. Helper to open the dialog with a section pre-selected
  const openDialogForSection = (sectionName: string) => {
    setSelectedSection(sectionName);
    setIsOpen(true);
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">App Items</h1>
          <p className="text-muted-foreground text-sm">Manage inventory items grouped by custom sections.</p>
        </div>

        {/* --- GLOBAL DIALOG --- */}
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="h-4 w-4" /> Add Item
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>Add New Item</DialogTitle>
              <DialogDescription>
                Create a item and choose which section to add it to.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleAddItem} className="space-y-4 pt-2">
              <div className="space-y-1">
                <Label htmlFor="name">Item Name</Label>
                <Input
                  id="name"
                  placeholder="e.g. Mustard Seed"
                  value={newItemName}
                  onChange={(e) => setNewItemName(e.target.value)}
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="price">Price (₹)</Label>
                <Input
                  id="price"
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={newItemPrice}
                  onChange={(e) => setNewItemPrice(e.target.value)}
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="section">Assign to Section</Label>
                <Select value={selectedSection} onValueChange={setSelectedSection}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a section" />
                  </SelectTrigger>
                  <SelectContent>
                    {sections.map((sec) => (
                      <SelectItem key={sec} value={sec}>
                        {sec}
                      </SelectItem>
                    ))}
                    <SelectItem value="new" className="text-primary font-medium">
                      + Create New Section
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Dynamic field displayed if "Create New Section" option is active */}
              {selectedSection === "new" && (
                <div className="space-y-1 transition-all duration-200">
                  <Label htmlFor="custom-section">New Section Name</Label>
                  <Input
                    id="custom-section"
                    placeholder="e.g. Spices"
                    value={customSection}
                    onChange={(e) => setCustomSection(e.target.value)}
                  />
                </div>
              )}

              <DialogFooter className="pt-4">
                <Button type="button" variant="outline" onClick={() => setIsOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit">Save Item</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <hr className="border-border" />

      {/* --- RENDER SECTIONS DYNAMICALLY --- */}
      <div className="grid gap-6 md:grid-cols-2">
        {sections.map((section) => (
          <Card key={section} className="shadow-sm">
            <CardHeader className="bg-muted/40 flex flex-row items-center justify-between py-3 px-4 space-y-0">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Package className="h-4 w-4 text-muted-foreground" />
                {section}
              </CardTitle>
              {/* Contextual Section Add Button */}
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1 text-xs"
                onClick={() => openDialogForSection(section)}
              >
                <Plus className="h-3 w-3" /> Add here
              </Button>
            </CardHeader>
            <CardContent className="p-0 divide-y divide-border">
              {items
                .filter((item) => item.section === section)
                .map((item) => (
                  <div key={item.id} className="flex justify-between items-center p-4 hover:bg-muted/10 transition-colors">
                    <span className="text-sm font-medium">{item.name}</span>
                    <span className="text-sm font-semibold text-muted-foreground">
                      ₹{item.price.toFixed(2)}
                    </span>
                  </div>
                ))}
            </CardContent>
          </Card>
        ))}

        {sections.length === 0 && (
          <div className="col-span-2 text-center py-12 text-muted-foreground border border-dashed rounded-lg">
            No items available. Click "Add Item" to initialize your first section.
          </div>
        )}
      </div>
    </div>
  );
}
