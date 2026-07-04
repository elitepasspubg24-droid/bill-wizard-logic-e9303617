import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { fetchFactories, fetchAppSettings } from "@/lib/queries";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { RotateCcw, Plus, Factory } from "lucide-react";

export const Route = createFileRoute("/_app/")({
  component: RatesPage,
  head: () => ({ meta: [{ title: "Daily Rates" }] }),
});

/**
 * Resolve a W string ("10%" / "11" / "") against a base.
 * Percentage → percent of base. Plain number → itself. Blank/invalid → 0.
 */
export function resolveW(input: string | number | undefined | null, base: number): number {
  if (input === null || input === undefined) return 0;
  const raw = String(input).trim();
  if (raw === "") return 0;
  if (raw.endsWith("%")) {
    const pct = Number(raw.slice(0, -1).trim());
    if (isNaN(pct)) return 0;
    return (Number(base) || 0) * (pct / 100);
  }
  const n = Number(raw);
  return isNaN(n) ? 0 : n;
}

function isValidWInput(input: string | number | undefined | null): boolean {
  if (input === null || input === undefined) return false;
  const raw = String(input).trim();
  if (raw === "") return true; // blank is allowed (means 0)
  if (raw.endsWith("%")) return !isNaN(Number(raw.slice(0, -1).trim()));
  return !isNaN(Number(raw));
}

function RatesPage() {
  const qc = useQueryClient();
  const factories = useQuery({ queryKey: ["factories"], queryFn: fetchFactories });
  const settings = useQuery({ queryKey: ["app_settings"], queryFn: fetchAppSettings });

  const [factoryRates, setFactoryRates] = useState<Record<string, string>>({});
  const [showAddForm, setShowAddForm] = useState(false);
