import { Receipt, ReceiptText } from "lucide-react";
import { useNoBill } from "../hooks/use-nobill";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

/**
 * Bill / No Bill switch — works like a dark/light mode toggle.
 * ON  = rates shown with the no-bill % markup
 * OFF = plain bill rates (the values stored in the database)
 */
export function NoBillToggle({ className = "" }: { className?: string }) {
  // Using the new Context state variables we created
  const { isNoBillMode, defaultPercentage, toggleMode, setDefaultPercentage } = useNoBill();

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {/* Your original styled button */}
      <button
        type="button"
        onClick={toggleMode}
        aria-pressed={isNoBillMode}
        title={isNoBillMode ? `No Bill mode: +${defaultPercentage}% (click for bill rates)` : "Bill rates (click for no-bill rates)"}
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors ${
          isNoBillMode
            ? "border-amber-300 bg-amber-100 text-amber-800 hover:bg-amber-200"
            : "border-border bg-muted/40 text-muted-foreground hover:text-foreground"
        }`}
      >
        <span
          className={`relative inline-block h-3.5 w-7 rounded-full transition-colors ${
            isNoBillMode ? "bg-amber-500" : "bg-muted-foreground/30"
          }`}
        >
          <span
            className={`absolute top-0.5 h-2.5 w-2.5 rounded-full bg-background transition-all ${
              isNoBillMode ? "left-[16px]" : "left-0.5"
            }`}
          />
        </span>
        {isNoBillMode ? <ReceiptText className="h-3.5 w-3.5" /> : <Receipt className="h-3.5 w-3.5" />}
        <span className="whitespace-nowrap">{isNoBillMode ? `No Bill` : "Bill"}</span>
      </button>

      {/* The new Percentage Dropdown that appears when enabled */}
      {isNoBillMode && (
        <Select 
          value={defaultPercentage.toString()} 
          onValueChange={(val) => setDefaultPercentage(Number(val))}
        >
          <SelectTrigger className="h-7 w-[70px] text-xs">
            <SelectValue placeholder="%" />
          </SelectTrigger>
          <SelectContent>
            {[9, 10, 11, 12, 13].map((num) => (
              <SelectItem key={num} value={num.toString()} className="text-xs">
                {num}%
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
