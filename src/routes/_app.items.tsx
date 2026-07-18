import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, useRef } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fetchFactories, fetchSections, fetchItems, fetchSaudas } from "@/lib/queries";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { 
  List, 
  Sliders, 
  FileText, 
  FileDown, 
  Plus, 
  Edit, 
  ShoppingCart, 
  Trash2, 
  Download, 
  ReceiptText, 
  Image as ImageIcon,
  History,
  ArrowLeftRight,
  ScanLine,
  Loader2,
  Share2,
  Phone,
  Truck,
  Info
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetFooter,
} from "@/components/ui/sheet";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { useServerFn } from "@tanstack/react-start";
import { extractBillFromImage } from "@/lib/ai.functions";

type ColKey = "gauge_diff" | "today" | "sauda" | "party" | "available_qty" | "last_purchase_rate";
const ALL_COLS: { key: ColKey; label: string }[] = [
  { key: "gauge_diff", label: "Gauge Diff" },
  { key: "today", label: "Today Rate" },
  { key: "sauda", label: "Sauda Rate" },
  { key: "party", label: "Party Rate" },
  { key: "available_qty", label: "Stock Qty" },
  { key: "last_purchase_rate", label: "Last Purchase" },
];
const DEFAULT_PDF_COLS: ColKey[] = ["available_qty", "last_purchase_rate"];

// UPGRADED CART ITEM WITH FACTORY & SAUDA PREVIEW METADATA
type CartItem = {
  id: string;
  name: string;
  rate: number;
  sectionName: string;
  qty?: string;
  gauge_diff: number;
  today: number;
  sauda: number | null;
  available_qty: number;
  last_purchase_rate: string | number | null;
  todayFactoryName?: string;
  todayBasic?: number;
  todayAdder?: number;
  partyAdder?: number;
  saudaName?: string;
  saudaBasic?: number;
};

export const Route = createFileRoute("/_app/items")({
  component: ItemsPage,
  head: () => ({ meta: [{ title: "Items Summary" }] }),
});

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

// ─── BROADCAST TEMPLATE SUB-SECTION (Matches your image 1:1) ────────────────
function BroadcastSection({ 
  title, 
  data, 
  manualRates, 
  setManualRates 
}: { 
  title: string, 
  data: any, 
  manualRates: Record<string, string>, 
  setManualRates: any 
}) {
  if (!data) return (
    <div className="border border-slate-400 bg-white/30 p-2 text-center text-[9px] italic text-slate-400 uppercase">
      {title} (Empty)
    </div>
  );

  return (
    <div className="border border-slate-400 shadow-sm overflow-hidden">
      <div className="bg-[#83b0b0] text-center font-bold text-[12px] py-0.5 border-b border-slate-400 uppercase tracking-tight text-slate-900">
        {title}
      </div>
      <table className="w-full text-[11px] bg-white border-collapse">
        <thead className="bg-[#cfe1e2] border-b border-slate-400 font-bold uppercase text-[9px]">
          <tr>
            <th className="p-1 border-r border-slate-400 text-left pl-2 text-slate-800">SIZE</th>
            <th className="p-1 border-r border-slate-400 w-12 text-center text-slate-800">BILL</th>
            <th className="p-1 w-12 text-center text-slate-800">NC</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r: any) => (
            <tr key={r.id} className="border-b border-slate-200 h-[26px]">
              <td className="p-1 pl-2 font-medium border-r border-slate-400 truncate max-w-[110px] text-slate-700 leading-none">{r.name}</td>
              <td className="p-1 text-center border-r border-slate-400 font-mono text-slate-500 font-bold leading-none">
                {r.today > 0 ? r.today.toFixed(0) : "—"}
              </td>
              <td className="p-0 text-center relative group">
                <input 
                  type="text"
                  className="w-full h-full text-center bg-transparent font-black border-none focus:ring-1 focus:ring-emerald-500 focus:bg-emerald-50 p-0 m-0 text-slate-900 leading-none transition-colors"
                  value={manualRates[r.id] ?? r.party.toFixed(0)}
                  onChange={(e) => setManualRates((prev: any) => ({ ...prev, [r.id]: e.target.value }))}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ItemsPage() {
  const factories = useQuery({ queryKey: ["factories"], queryFn: fetchFactories });
  const sections = useQuery({ queryKey: ["sections"], queryFn: fetchSections });
  const items = useQuery({ queryKey: ["items"], queryFn: fetchItems });
  const saudas = useQuery({ queryKey: ["saudas"], queryFn: fetchSaudas });
  const queryClient = useQueryClient();
  const extract = useServerFn(extractBillFromImage);
  
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState("");
  const [pickedTodayFactory, setPickedTodayFactory] = useState<Record<string, string>>({});
  const [pickedSauda, setPickedSauda] = useState<Record<string, string>>({});
  const [isEditingGauges, setIsEditingGauges] = useState(false);
  const [localGauges, setLocalGauges] = useState<Record<string, number>>({});
  const [pdfCols, setPdfCols] = useState<ColKey[]>(DEFAULT_PDF_COLS);

  // --- CART STATE ---
  const [cart, setCart] = useState<CartItem[]>([]);
  const [partyName, setPartyName] = useState("");

  // --- BROADCAST STATE ---
  const [isBroadcastOpen, setIsBroadcastOpen] = useState(false);
  const [manualRates, setManualRates] = useState<Record<string, string>>({});

  // --- AI SCAN STATE ---
  const [isExtracting, setIsExtracting] = useState(false);
  const [isScanEnquiryOpen, setIsScanEnquiryOpen] = useState(false);

  // --- DIALOG STATES ---
  const [isSectionDialogOpen, setIsSectionDialogOpen] = useState(false);
  const [isItemDialogOpen, setIsItemDialogOpen] = useState(false);
  const [historyItem, setHistoryItem] = useState<any | null>(null);
  const [ledgerItem, setLedgerItem] = useState<any | null>(null);

  const [sectionForm, setSectionForm] = useState({ id: "", name: "", factory_id: "" });
  const [itemForm, setItemForm] = useState({
    id: "",
    name: "",
    section_id: "",
    gauge_diff: 0,
    available_qty: 0,
    last_purchase_rate: "",
  });

  // Fetch last 3 purchases
  const itemHistory = useQuery({
    queryKey: ["item_history", historyItem?.id],
    queryFn: async () => {
      if (!historyItem?.id) return [];
      const { data, error } = await supabase
        .from("purchase_history")
        .select("vendor_name, purchase_date, rate")
        .eq("item_id", historyItem.id)
        .order("purchase_date", { ascending: false })
        .limit(3);
      return data || [];
    },
    enabled: !!historyItem,
  });

  // Fetch last 10 activities (ledger)
  const itemLedger = useQuery({
    queryKey: ["item_ledger", ledgerItem?.id],
    queryFn: async () => {
      if (!ledgerItem?.id) return [];
      const { data, error } = await supabase
        .from("bill_items")
        .select(`
          qty,
          bills!inner (
            bill_date,
            vendor,
            type,
            created_at
          )
        `)
        .eq("item_id", ledgerItem.id)
        .order("bill_date", { referencedTable: 'bills', ascending: false })
        .order("created_at", { referencedTable: 'bills', ascending: false })
        .limit(10);
      
      if (error) throw error;
      return data || [];
    },
    enabled: !!ledgerItem,
  });

  const allOpenSaudas = useMemo(() => {
    if (!saudas.data) return [];
    return (saudas.data as any[]).filter(s => s.factory_id && s.status !== "done").map(s => ({
      id: s.id,
      basic: Number(s.sauda_basic),
      party: s.party_name,
      factory_id: s.factory_id,
      pending: Math.max(0, (Number(s.total_qty || 0) || (s.sauda_items ?? []).reduce((a: number, r: any) => a + Number(r.qty || 0), 0)) - Number(s.lifted_qty || 0))
    }));
  }, [saudas.data]);

  const grouped = useMemo(() => {
    if (!sections.data || !items.data || !factories.data) return [];
    const fmap = new Map(factories.data.map((f: any) => [f.id, f]));

    return sections.data.map((s: any) => {
      const activeTodayFactoryId = pickedTodayFactory[s.id] ?? s.factory_id;
      const activeTodayFactory: any = fmap.get(activeTodayFactoryId);
      const activeFacBasic = Number(activeTodayFactory?.basic_rate ?? 0);
      const activeFacAdder = Number(activeTodayFactory?.adder ?? 0);
      const activePartyAdder = Number(activeTodayFactory?.party_adder ?? 0);

      const baseToday = activeFacBasic + activeFacAdder;
      const baseParty = baseToday + activePartyAdder;

      const topSauda = allOpenSaudas.find(
        (so) => so.id === pickedSauda[s.id] || (so.factory_id === activeTodayFactoryId && !pickedSauda[s.id])
      );
      const saudaFactory: any = topSauda ? fmap.get(topSauda.factory_id) : null;
      const saudaFacAdder = Number(saudaFactory?.adder ?? 0);
      const baseSauda = topSauda ? topSauda.basic + saudaFacAdder : null;

      const rows = items.data!
        .filter((i: any) => i.section_id === s.id)
        .filter((i: any) => !q || i.name.toLowerCase().includes(q.toLowerCase()))
        .map((i: any) => {
          const gaugeDiff =
            localGauges[i.id] !== undefined ? localGauges[i.id] : Number(i.gauge_diff ?? 0);
          return {
            ...i,
            gauge_diff: gaugeDiff,
            today: baseToday + gaugeDiff,
            sauda: baseSauda !== null ? baseSauda + gaugeDiff : null,
            party: baseParty + gaugeDiff,
          };
        });

      return {
        section: s,
        activeTodayFactory,
        activeFacBasic,
        activeFacAdder,
        activePartyAdder,
        topSauda,
        saudaFactory,
        saudaFacAdder,
        rows,
      };
    })
    .filter((g: any) => g.rows.length > 0)
    .sort((a: any, b: any) => a.section.position - b.section.position);
  }, [factories.data, sections.data, items.data, pickedTodayFactory, pickedSauda, allOpenSaudas, q, localGauges]);

  const toggleCart = (item: any, sectionName: string, meta?: any) => {
    setCart((prev) => {
      const isSelected = prev.find((i) => i.id === item.id);
      if (isSelected) return prev.filter((i) => i.id !== item.id);
      return [...prev, { 
        id: item.id, name: item.name, rate: item.party, sectionName, qty: "",
        gauge_diff: item.gauge_diff, today: item.today, sauda: item.sauda,
        available_qty: item.available_qty, last_purchase_rate: item.last_purchase_rate,
        todayFactoryName: meta?.activeTodayFactory?.name, todayBasic: meta?.activeFacBasic,
        todayAdder: meta?.activeFacAdder, partyAdder: meta?.activePartyAdder,
        saudaName: meta?.topSauda?.party, saudaBasic: meta?.topSauda?.basic,
      }];
    });
  };

  const handleEnquiryScan = async (file: File) => {
    if (!file) return;
    setIsExtracting(true);
    const tid = toast.loading("AI scanning enquiry requirements...");
    try {
      const dataUrl = await fileToDataUrl(file);
      const sectionMap = new Map((sections.data ?? []).map((s: any) => [s.id, s.name]));
      const catalog = (items.data ?? []).map((it: any) => ({
        id: it.id, name: it.name, section: it.section_id ? sectionMap.get(it.section_id) ?? null : null,
      }));
      const result = await extract({ data: { dataUrl, type: "sale", catalog } });
      const newItems: CartItem[] = [];
      result.items.forEach((extracted) => {
        if (!extracted.matched_item_id) return;
        for (const g of grouped) {
          const found = g.rows.find((r: any) => r.id === extracted.matched_item_id);
          if (found && !cart.some(c => c.id === found.id)) {
            newItems.push({
              id: found.id, name: found.name, rate: found.party, sectionName: g.section.name,
              qty: extracted.qty > 0 ? String(extracted.qty) : "",
              gauge_diff: found.gauge_diff, today: found.today, sauda: found.sauda,
              available_qty: found.available_qty, last_purchase_rate: found.last_purchase_rate,
              todayFactoryName: g.activeTodayFactory?.name, todayBasic: g.activeFacBasic,
              todayAdder: g.activeFacAdder, partyAdder: g.activePartyAdder,
              saudaName: g.topSauda?.party, saudaBasic: g.topSauda?.basic,
            });
            break;
          }
        }
      });
      if (newItems.length > 0) {
        setCart(prev => [...prev, ...newItems]);
        if (result.vendor) setPartyName(result.vendor);
        toast.success(`Added ${newItems.length} items from scan`, { id: tid });
      } else toast.warning("No matches found", { id: tid });
      setIsScanEnquiryOpen(false);
    } catch (e: any) {
      toast.error(e.message, { id: tid });
    } finally {
      setIsExtracting(false);
    }
  };

  const handleExportImage = async (elementId: string) => {
    const tid = toast.loading("Generating high-fidelity image...");
    try {
      const win = window as any;
      if (!win.htmlToImage) {
        await new Promise((resolve, reject) => {
          const script = document.createElement("script");
          script.src = "https://cdnjs.cloudflare.com/ajax/libs/html-to-image/1.11.11/html-to-image.min.js";
          script.onload = resolve; script.onerror = reject;
          document.head.appendChild(script);
        });
      }
      const element = document.getElementById(elementId);
      if (!element) throw new Error("Capture area not found");
      const dataUrl = await win.htmlToImage.toPng(element, { backgroundColor: '#ffffff', quality: 1, pixelRatio: 3 });
      const link = document.createElement("a");
      link.download = elementId === "capture-area" ? "Quotation.png" : "Daily_Rate_List.png";
      link.href = dataUrl; link.click();
      toast.success("Ready for WhatsApp!", { id: tid });
    } catch (err) {
      toast.error("Export failed. Use manual screenshot.", { id: tid });
    }
  };

  const updateCartRate = (id: string, rate: number) => setCart(p => p.map(i => i.id === id ? { ...i, rate } : i));
  const updateCartQty = (id: string, qty: string) => setCart(p => p.map(i => i.id === id ? { ...i, qty } : i));

  const handleSaveSection = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    try {
      if (sectionForm.id) await supabase.from("sections").update({ name: sectionForm.name.trim(), factory_id: sectionForm.factory_id }).eq("id", sectionForm.id);
      else await supabase.from("sections").insert({ name: sectionForm.name.trim(), factory_id: sectionForm.factory_id, position: sections.data?.length ?? 0 });
      toast.success("Section updated");
      await queryClient.invalidateQueries({ queryKey: ["sections"] }); setIsSectionDialogOpen(false);
    } finally { setSaving(false); }
  };

  const handleSaveItem = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    try {
      const payload = { 
        name: itemForm.name.trim(), section_id: itemForm.section_id, 
        gauge_diff: Number(itemForm.gauge_diff) || 0, available_qty: Number(itemForm.available_qty) || 0,
        last_purchase_rate: itemForm.last_purchase_rate === "" ? null : Number(itemForm.last_purchase_rate)
      };
      if (itemForm.id) await supabase.from("items").update(payload).eq("id", itemForm.id);
      else await supabase.from("items").insert({ ...payload, position: items.data?.length ?? 0 });
      toast.success("Item saved");
      await queryClient.invalidateQueries({ queryKey: ["items"] }); setIsItemDialogOpen(false);
    } finally { setSaving(false); }
  };

  const handleExportCSV = () => {
    let csv = "data:text/csv;charset=utf-8,Section,Item,Today,NC,Stock\r\n";
    grouped.forEach(g => g.rows.forEach(r => csv += `${g.section.name},${r.name},${r.today},${r.party},${r.available_qty}\r\n`));
    const encodedUri = encodeURI(csv);
    const link = document.createElement("a"); link.setAttribute("href", encodedUri); link.setAttribute("download", "Rate_List.csv"); document.body.appendChild(link); link.click();
  };

  const openAddItem = (sid?: string) => { setItemForm({ id: "", name: "", section_id: sid || sections.data?.[0]?.id || "", gauge_diff: 0, available_qty: 0, last_purchase_rate: "" }); setIsItemDialogOpen(true); };
  const openEditItem = (it: any) => { setItemForm({ id: it.id, name: it.name, section_id: it.section_id, gauge_diff: it.gauge_diff, available_qty: Number(it.available_qty || 0), last_purchase_rate: it.last_purchase_rate != null ? String(it.last_purchase_rate) : "" }); setIsItemDialogOpen(true); };
  const openAddSection = () => { setSectionForm({ id: "", name: "", factory_id: factories.data?.[0]?.id || "" }); setIsSectionDialogOpen(true); };
  const openEditSection = (s: any) => { setSectionForm({ id: s.id, name: s.name, factory_id: s.factory_id || "" }); setIsSectionDialogOpen(true); };

  const getSectionByName = (n: string) => grouped.find(g => g.section.name.toLowerCase().includes(n.toLowerCase()));

  return (
    <div className="w-full space-y-4 pb-20">
      <div className="flex items-center justify-between border-b pb-3 gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-bold">Items Matrix</h2>
          
          <div className="flex items-center gap-2">
            {/* 📢 BROADCAST LOGIC (4-COLUMN 1:1 REPLICA) 📢 */}
            <Dialog open={isBroadcastOpen} onOpenChange={setIsBroadcastOpen}>
              <DialogTrigger asChild>
                <Button variant="default" size="sm" className="h-9 gap-1.5 bg-emerald-600 hover:bg-emerald-700 font-bold border-b-2 border-emerald-800 active:border-b-0">
                  <Share2 className="h-4 w-4" /> Broadcast Rates
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-[95vw] lg:max-w-6xl max-h-[95vh] overflow-y-auto p-0 border-none bg-slate-200">
                <div className="sticky top-0 z-50 bg-white border-b p-4 flex items-center justify-between shadow-sm">
                   <div>
                     <DialogTitle className="text-xl font-bold flex items-center gap-2 text-slate-800">
                        <ImageIcon className="h-5 w-5 text-emerald-600" /> Daily Broadcast Preview
                     </DialogTitle>
                     <p className="text-xs text-muted-foreground flex items-center gap-1"><Info className="h-3 w-3" /> Click NC values to type manual overrides before downloading.</p>
                   </div>
                   <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => setManualRates({})}>Reset Rates</Button>
                      <Button onClick={() => handleExportImage("broadcast-area")} className="bg-emerald-600 hover:bg-emerald-700 gap-2 h-10 px-6 font-bold shadow-md">
                        <Download className="h-4 w-4" /> Download Image
                      </Button>
                   </div>
                </div>

                <div className="flex justify-center p-6 bg-slate-300">
                  {/* BROADCAST AREA (Exact Visual Replica) */}
                  <div id="broadcast-area" style={{ width: '1000px', backgroundColor: '#f3f4f6', color: '#334155', fontFamily: 'Arial, sans-serif' }} className="p-8 shadow-2xl border border-slate-400">
                      <div className="bg-[#8ec2c2] p-5 text-center border-b-4 border-slate-500 mb-8 rounded-sm">
                        <h1 className="text-[48px] font-black tracking-[0.2em] text-slate-900 uppercase" style={{ textShadow: '2px 2px 0px white' }}>MAA BHAVANI STEEL, NAGPUR</h1>
                      </div>

                      <div className="grid grid-cols-4 gap-4 items-start">
                        <div className="space-y-4">
                          <BroadcastSection title="MS ANGLE" data={getSectionByName("angle")} manualRates={manualRates} setManualRates={setManualRates} />
                          <BroadcastSection title="MS CHANNEL" data={getSectionByName("channel")} manualRates={manualRates} setManualRates={setManualRates} />
                        </div>
                        <div className="space-y-4">
                          <BroadcastSection title="I BEAM" data={getSectionByName("beam")} manualRates={manualRates} setManualRates={setManualRates} />
                          <BroadcastSection title="MS SQ BAR" data={getSectionByName("square bar")} manualRates={manualRates} setManualRates={setManualRates} />
                          <BroadcastSection title="MS ROUND BAR" data={getSectionByName("round bar")} manualRates={manualRates} setManualRates={setManualRates} />
                          <BroadcastSection title="HR PLATE/SHEET" data={getSectionByName("plate")} manualRates={manualRates} setManualRates={setManualRates} />
                        </div>
                        <div className="space-y-4">
                          <BroadcastSection title="MS FLAT" data={getSectionByName("flat")} manualRates={manualRates} setManualRates={setManualRates} />
                          <BroadcastSection title="CHQ PLATE" data={getSectionByName("chq")} manualRates={manualRates} setManualRates={setManualRates} />
                        </div>
                        <div className="space-y-4">
                          <div className="border border-slate-400 overflow-hidden">
                             <div className="bg-[#b9d7d9] text-center font-bold text-[13px] py-1 border-b border-slate-400 uppercase tracking-tighter text-slate-900">MS PIPE</div>
                             <table className="w-full text-[12px] bg-white border-collapse">
                               <thead className="bg-[#d1e5e7] border-b border-slate-400 font-bold uppercase text-[9px]">
                                 <tr><th className="p-1 border-r border-slate-400 text-left pl-2">ITEM</th><th className="p-1 border-r border-slate-400 w-12">BILL</th><th className="p-1 w-12">NC</th></tr>
                               </thead>
                               <tbody>
                                 <tr className="border-b border-slate-200">
                                   <td className="p-1 pl-2 font-bold border-r border-slate-400">PIPE BASIC</td>
                                   <td className="p-1 text-center border-r border-slate-400 font-bold">{getSectionByName("pipe")?.activeFacBasic || "—"}</td>
                                   <td className="p-1 text-center font-bold bg-slate-50">{(getSectionByName("pipe")?.activeFacBasic || 0) + (getSectionByName("pipe")?.activePartyAdder || 0)}</td>
                                 </tr>
                               </tbody>
                             </table>
                          </div>
                          <BroadcastSection title="HEAVY PIPE" data={getSectionByName("pipe")} manualRates={manualRates} setManualRates={setManualRates} />
                        </div>
                      </div>

                      <div className="mt-10 pt-6 border-t-2 border-slate-300">
                         <div className="grid grid-cols-2 text-[14px] italic text-slate-700 font-semibold gap-y-2">
                            <div className="flex items-center gap-2"><ArrowLeftRight className="h-4 w-4 text-blue-600" /> Ex-Butibori (Nagpur) Rates.</div>
                            <div className="flex items-center gap-2"><Plus className="h-4 w-4 text-amber-600" /> Specials Sizes Available on Request</div>
                            <div className="flex items-center gap-2"><Truck className="h-4 w-4 text-slate-500" /> Loading Extra.</div>
                            <div className="flex items-center gap-2 font-black text-slate-900"><ReceiptText className="h-4 w-4 text-red-600" /> GST Extra on Bill Rate.</div>
                         </div>
                         <div className="mt-5 text-[12px] text-slate-500 font-medium italic">(Note: A delay penalty of 40/MT per day applies to late settlements).</div>
                         <div className="mt-8 flex items-center justify-center gap-2 text-slate-900 text-[20px] font-black border-t-4 border-slate-400 pt-6">
                            Connect with us: <Phone className="h-6 w-6 text-emerald-600 fill-emerald-600 ml-2" /> 9423102235 | 9423104435 | 9665154631 (Whatsapp or Call)
                         </div>
                      </div>
                  </div>
                </div>
              </DialogContent>
            </Dialog>

            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline" size="sm" className="relative h-9 gap-2">
                  <ShoppingCart className="h-4 w-4" /> Cart
                  {cart.length > 0 && <span className="absolute -top-1 -right-1 bg-primary text-primary-foreground text-[10px] rounded-full h-4 w-4 flex items-center justify-center font-bold">{cart.length}</span>}
                </Button>
              </SheetTrigger>
              <SheetContent className="w-full sm:max-w-2xl overflow-y-auto flex flex-col">
                <SheetHeader><SheetTitle>Quotation Cart</SheetTitle></SheetHeader>
                <div className="flex-1 py-4 space-y-4">
                  <Input placeholder="Party Name" value={partyName} onChange={e=>setPartyName(e.target.value)} />
                  {cart.map(i => (
                    <div key={i.id} className="border p-3 rounded-lg bg-muted/20 space-y-2">
                      <div className="flex justify-between items-start">
                        <div className="text-sm font-bold">{i.name}</div>
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={()=>setCart(p=>p.filter(x=>x.id!==i.id))}><Trash2 className="h-3 w-3"/></Button>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <Input type="text" placeholder="Qty (e.g. 0.360t)" value={i.qty} onChange={e=>setCart(p=>p.map(x=>x.id===i.id?{...x, qty: e.target.value}:x))} />
                        <Input type="number" value={i.rate} onChange={e=>setCart(p=>p.map(x=>x.id===i.id?{...x, rate: Number(e.target.value)}:x))} />
                      </div>
                    </div>
                  ))}
                  <div style={{ position: 'fixed', top: '-5000px' }}><div id="capture-area" className="p-10 bg-white text-black" style={{ width: '600px' }}>
                    <h2 className="text-2xl font-bold mb-4 uppercase tracking-tight">Quotation: {partyName || 'Customer'}</h2>
                    <table className="w-full border-collapse"><thead className="bg-slate-100 border-b font-bold"><tr><th className="p-3 text-left">Description</th><th className="p-3 text-center">Qty</th><th className="p-3 text-right">Rate</th></tr></thead><tbody>{cart.map(c=>(<tr key={c.id} className="border-b"><td className="p-3 font-medium">{c.name}</td><td className="p-3 text-center">{c.qty||'—'}</td><td className="p-3 text-right font-black">₹{Number(c.rate).toFixed(0)}</td></tr>))}</tbody></table>
                  </div></div>
                </div>
                <SheetFooter><Button onClick={()=>handleExportImage("capture-area")} disabled={!cart.length} className="w-full h-12 font-bold text-lg">Generate Quote Image</Button></SheetFooter>
              </SheetContent>
            </Sheet>

            <Dialog open={isScanEnquiryOpen} onOpenChange={setIsScanEnquiryOpen}>
              <DialogTrigger asChild><Button variant="outline" size="sm" className="h-9 gap-1.5 text-blue-600 border-blue-200"><ScanLine className="h-4 w-4" /> Scan Enquiry</Button></DialogTrigger>
              <DialogContent><DialogHeader><DialogTitle>AI Scanner</DialogTitle></DialogHeader>
                <div className="py-4 space-y-4">
                  <Input type="file" onChange={e => e.target.files?.[0] && handleEnquiryScan(e.target.files[0])} disabled={isExtracting} />
                  {isExtracting && <div className="flex flex-col items-center py-6 gap-2"><Loader2 className="animate-spin h-8 w-8 text-primary" /><p className="text-sm font-medium">Reading document...</p></div>}
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <Input placeholder="Search..." value={q} onChange={e=>setQ(e.target.value)} className="w-40 md:w-60 h-9" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button size="sm" className="h-9 gap-1.5"><Plus className="h-4 w-4" /> Add New</Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end"><DropdownMenuItem onClick={()=>openAddItem()}>Add Item</DropdownMenuItem><DropdownMenuItem onClick={openAddSection}>Add Section</DropdownMenuItem></DropdownMenuContent>
          </DropdownMenu>
          <Button onClick={() => setIsEditingGauges(!isEditingGauges)} variant={isEditingGauges ? "default" : "outline"} size="sm" className="h-9 hidden md:flex"><Sliders className="h-4 w-4 mr-1" /> Edit Gauges</Button>
          <Button onClick={handleExportCSV} variant="outline" size="sm" className="h-9 gap-2"><FileDown className="h-4 w-4" /> CSV</Button>
        </div>
      </div>

      <div className="space-y-6">
        {grouped.map((g) => (
          <Card key={g.section.id} id={`section-${g.section.id}`}>
            <div className="p-4 border-b bg-muted/10 flex justify-between items-center flex-wrap gap-2">
              <div>
                <h3 className="text-base font-bold flex items-center gap-1.5">{g.section.name} <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => openEditSection(g.section)}><Edit className="h-3 w-3"/></Button></h3>
                <p className="text-[10px] text-muted-foreground uppercase font-medium">{g.activeTodayFactory?.name} (₹{g.activeFacBasic} + ₹{g.activeFacAdder})</p>
              </div>
              <div className="flex items-center gap-2">
                <Select value={pickedTodayFactory[g.section.id] ?? g.section.factory_id} onValueChange={v=>setPickedTodayFactory(p=>({...p, [g.section.id]: v}))}>
                  <SelectTrigger className="h-8 w-40 text-[11px]"><SelectValue/></SelectTrigger>
                  <SelectContent>{factories.data?.map((f:any)=><SelectItem key={f.id} value={f.id} className="text-[11px]">{f.name}</SelectItem>)}</SelectContent>
                </Select>
                {allOpenSaudas.length > 0 && (
                  <Select value={pickedSauda[g.section.id] ?? g.topSauda?.id ?? ""} onValueChange={v=>setPickedSauda(p=>({...p, [g.section.id]: v}))}>
                    <SelectTrigger className="h-8 w-44 text-[11px]"><SelectValue placeholder="Sauda"/></SelectTrigger>
                    <SelectContent>{allOpenSaudas.map(s=><SelectItem key={s.id} value={s.id} className="text-[11px]">{s.party} (₹{s.basic})</SelectItem>)}</SelectContent>
                  </Select>
                )}
              </div>
            </div>
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead className="bg-muted/5 text-muted-foreground text-[10px] uppercase font-black border-b tracking-widest">
                  <tr><th className="p-3 text-left">Item Description</th><th className="p-3 text-right">± Gauge</th><th className="p-3 text-right">Today</th><th className="p-3 text-right text-primary">Party (NC)</th><th className="p-3 text-right">Stock</th><th className="p-3 text-right pr-4">Actions</th></tr>
                </thead>
                <tbody className="divide-y">
                  {g.rows.map((r: any) => (
                    <tr key={r.id} className={`hover:bg-muted/5 group ${cart.some(c=>c.id===r.id)?'bg-emerald-50/30':''}`}>
                      <td className="p-3 font-semibold text-slate-800">{r.name}</td>
                      <td className="p-3 text-right font-mono text-slate-400">
                        {isEditingGauges ? (
                          <Input type="number" value={r.gauge_diff} onChange={e=>setLocalGauges(p=>({...p, [r.id]: Number(e.target.value)}))} className="h-7 w-16 ml-auto text-right text-xs p-1"/>
                        ) : (r.gauge_diff > 0 ? `+${r.gauge_diff}` : r.gauge_diff)}
                      </td>
                      <td className="p-3 text-right font-mono text-slate-500 font-medium">₹{r.today.toFixed(0)}</td>
                      <td className="p-3 text-right font-mono font-black text-slate-900 bg-primary/[0.03]">₹{r.party.toFixed(0)}</td>
                      <td className="p-3 text-right">
                        <button onClick={()=>setLedgerItem(r)} className="underline underline-offset-4 decoration-muted-foreground/20 hover:text-primary font-bold text-slate-700">{Number(r.available_qty).toFixed(1)}t</button>
                      </td>
                      <td className="p-3 text-right flex justify-end gap-1 pr-4">
                        <Button variant="ghost" size="icon" className={`h-8 w-8 ${cart.some(c=>c.id===r.id)?'text-emerald-600 bg-emerald-50':''}`} onClick={() => toggleCart(r, g.section.name, g)}><ShoppingCart className="h-4 w-4"/></Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 opacity-0 group-hover:opacity-100" onClick={() => openEditItem(r)}><Edit className="h-4 w-4"/></Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-primary" onClick={() => setHistoryItem(r)}><History className="h-4 w-4"/></Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* --- ALL LOGIC DIALOGS --- */}
      <Dialog open={!!ledgerItem} onOpenChange={o=>!o && setLedgerItem(null)}>
        <DialogContent><DialogHeader><DialogTitle>Stock Activity: {ledgerItem?.name}</DialogTitle></DialogHeader>
          <div className="border rounded-md divide-y max-h-[400px] overflow-y-auto">
             {itemLedger.data?.map((e:any, idx:number)=>(
               <div key={idx} className="p-3 text-xs flex justify-between items-center hover:bg-muted/30">
                 <div><span className="font-bold text-slate-900">{e.bills.vendor}</span><p className="text-muted-foreground">{new Date(e.bills.bill_date).toLocaleDateString()} • {e.bills.type}</p></div>
                 <span className={`font-black text-sm px-2 py-0.5 rounded ${e.bills.type==='purchase'?'bg-emerald-50 text-emerald-700':'bg-blue-50 text-blue-700'}`}>{e.bills.type==='purchase'?'+':'-'}{Number(e.qty).toFixed(2)}t</span>
               </div>
             ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!historyItem} onOpenChange={o=>!o && setHistoryItem(null)}>
        <DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>Recent Purchases: {historyItem?.name}</DialogTitle></DialogHeader>
          <div className="border rounded-md divide-y overflow-hidden">
             <div className="grid grid-cols-3 bg-muted/50 p-2.5 text-[10px] font-black uppercase tracking-widest text-muted-foreground"><div>Vendor</div><div className="text-center">Date</div><div className="text-right">Rate</div></div>
             {itemHistory.data?.map((p:any, idx:number)=>(
               <div key={idx} className="grid grid-cols-3 p-3 text-xs items-center hover:bg-muted/10">
                 <div className="font-bold text-slate-800 truncate pr-2">{p.vendor_name}</div>
                 <div className="text-center text-muted-foreground font-medium">{new Date(p.purchase_date).toLocaleDateString()}</div>
                 <div className="text-right font-black text-primary text-sm">₹{Number(p.rate).toFixed(0)}</div>
               </div>
             ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isSectionDialogOpen} onOpenChange={setIsSectionDialogOpen}>
        <DialogContent><DialogHeader><DialogTitle>Section Profile</DialogTitle></DialogHeader>
          <form onSubmit={handleSaveSection} className="space-y-4">
            <div className="space-y-1"><Label>Name</Label><Input value={sectionForm.name} onChange={e=>setSectionForm({...sectionForm, name: e.target.value})} required/></div>
            <div className="space-y-1"><Label>Factory</Label>
              <Select value={sectionForm.factory_id} onValueChange={v=>setSectionForm({...sectionForm, factory_id: v})}>
                <SelectTrigger><SelectValue/></SelectTrigger>
                <SelectContent>{factories.data?.map((f:any)=><SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Button type="submit" className="w-full font-bold" disabled={saving}>Save Section</Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={isItemDialogOpen} onOpenChange={setIsItemDialogOpen}>
        <DialogContent><DialogHeader><DialogTitle>Item Details</DialogTitle></DialogHeader>
          <form onSubmit={handleSaveItem} className="space-y-4">
            <div className="space-y-1"><Label>Size / Description</Label><Input value={itemForm.name} onChange={e=>setItemForm({...itemForm, name: e.target.value})} required/></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label>Gauge ±</Label><Input type="number" value={itemForm.gauge_diff} onChange={e=>setItemForm({...itemForm, gauge_diff: Number(e.target.value)})}/></div>
              <div className="space-y-1"><Label>Stock MT</Label><Input type="number" step="0.01" value={itemForm.available_qty} onChange={e=>setItemForm({...itemForm, available_qty: Number(e.target.value)})}/></div>
            </div>
            <Button type="submit" className="w-full font-bold" disabled={saving}>Save Item</Button>
          </form>
        </DialogContent>
      </Dialog>

      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button size="icon" className="fixed bottom-6 right-6 h-12 w-12 rounded-full shadow-2xl z-50"><List /></Button></DropdownMenuTrigger>
        <DropdownMenuContent className="w-56" align="end" side="top">
          <DropdownMenuLabel>Jump to Section</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {grouped.map(g => <DropdownMenuItem key={g.section.id} onSelect={()=>document.getElementById(`section-${g.section.id}`)?.scrollIntoView({ behavior: "smooth" })}>{g.section.name}</DropdownMenuItem>)}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
