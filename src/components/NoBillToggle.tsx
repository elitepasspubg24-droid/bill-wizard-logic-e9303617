import { Receipt, ReceiptText } from "lucide-react";
import { useNoBill } from "@/hooks/use-nobill";
import { toggleNoBill } from "@/lib/nobill";

/**
 * Bill / No Bill switch — works like a dark/light mode toggle.
 * ON  = rates shown with the no-bill % markup
 * OFF = plain bill rates (the values stored in the database)
 */
export function NoBillToggle({ className = "" }: { className?: string }) {
  const { enabled, defaultPct } = useNoBill();

  return (
    <button
      type="button"
      onClick={() => toggleNoBill()}
      aria-pressed={enabled}
      title={enabled ? `No Bill mode: +${defaultPct}% (click for bill rates)` : "Bill rates (click for no-bill rates)"}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors ${
        enabled
          ? "border-amber-300 bg-amber-100 text-amber-800 hover:bg-amber-200"
          : "border-border bg-muted/40 text-muted-foreground hover:text-foreground"
      } ${className}`}
    >
      <span
        className={`relative inline-block h-3.5 w-7 rounded-full transition-colors ${
          enabled ? "bg-amber-500" : "bg-muted-foreground/30"
        }`}
      >
        <span
          className={`absolute top-0.5 h-2.5 w-2.5 rounded-full bg-background transition-all ${
            enabled ? "left-[16px]" : "left-0.5"
          }`}
        />
      </span>
      {enabled ? <ReceiptText className="h-3.5 w-3.5" /> : <Receipt className="h-3.5 w-3.5" />}
      <span className="whitespace-nowrap">{enabled ? `No Bill +${defaultPct}%` : "Bill"}</span>
    </button>
  );
}
