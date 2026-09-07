import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Trash2 } from "lucide-react";

export const Route = createFileRoute("/_app/whatsapp")({
  head: () => ({
    meta: [
      { title: "WhatsApp Enquiries | Steel Rate Manager" },
      {
        name: "description",
        content:
          "Manage which WhatsApp numbers can ask the bot for stock and last purchase prices.",
      },
      { property: "og:title", content: "WhatsApp Enquiries | Steel Rate Manager" },
      {
        property: "og:description",
        content: "Approve the WhatsApp numbers allowed to check stock and purchase rates.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: WhatsAppPage,
});

async function fetchNumbers() {
  const { data, error } = await supabase
    .from("whatsapp_allowed_numbers")
    .select("*")
    .order("created_at");
  if (error) throw error;
  return data;
}

function WhatsAppPage() {
  const qc = useQueryClient();
  const numbers = useQuery({ queryKey: ["wa-numbers"], queryFn: fetchNumbers });
  const [phone, setPhone] = useState("");
  const [label, setLabel] = useState("");

  const add = async () => {
    const clean = phone.replace(/\D/g, "");
    if (clean.length < 10) {
      toast.error("Enter a full phone number with country code.");
      return;
    }
    const { error } = await supabase
      .from("whatsapp_allowed_numbers")
      .insert({ phone: clean, label: label.trim() || null });
    if (error) {
      toast.error(error.message);
      return;
    }
    setPhone("");
    setLabel("");
    qc.invalidateQueries({ queryKey: ["wa-numbers"] });
    toast.success("Number approved.");
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("whatsapp_allowed_numbers").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    qc.invalidateQueries({ queryKey: ["wa-numbers"] });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold">WhatsApp Enquiries</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Only the numbers below get a reply. Anyone else is politely refused. Send an item
          list as text or a photo and the bot replies with available quantity and the last 3
          purchases.
        </p>
      </div>

      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Phone with country code, e.g. 919876543210"
            className="flex-1 rounded-md border bg-background px-3 py-2 text-sm"
          />
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Name (optional)"
            className="sm:w-48 rounded-md border bg-background px-3 py-2 text-sm"
          />
          <button
            onClick={add}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Approve
          </button>
        </div>

        <div className="divide-y">
          {(numbers.data ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground py-2">No approved numbers yet.</p>
          )}
          {(numbers.data ?? []).map((n: any) => (
            <div key={n.id} className="flex items-center justify-between py-2">
              <div>
                <div className="text-sm font-medium">+{n.phone}</div>
                {n.label && <div className="text-xs text-muted-foreground">{n.label}</div>}
              </div>
              <button
                onClick={() => remove(n.id)}
                className="text-muted-foreground hover:text-destructive"
                aria-label="Remove number"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
