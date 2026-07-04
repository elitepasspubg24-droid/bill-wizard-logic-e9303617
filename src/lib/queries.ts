import { supabase } from "@/integrations/supabase/client";

export async function fetchFactories() {
  const { data, error } = await supabase
    .from("factories")
    .select("*")
    .order("position");
  if (error) throw error;
  return data;
}

export async function fetchSections() {
  const { data, error } = await supabase
    .from("sections")
    .select("*")
    .order("position");
  if (error) throw error;
  return data;
}

export async function fetchItems() {
  const { data, error } = await supabase
    .from("items")
    .select("*")
    .order("position");
  if (error) throw error;
  return data;
}

export async function fetchBills() {
  const { data, error } = await supabase
    .from("bills")
    .select("*, bill_items(*)")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function fetchSaudas() {
  const { data, error } = await supabase
    .from("saudas")
    .select("*, sauda_items(*), factories(name), bills:linked_bill_id(bill_no, vendor), sauda_uplifts(*)")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}
ts
export async function fetchAppSettings() {
  const { data, error } = await supabase
    .from("app_settings")
    .select("*")
    .eq("id", "global")
    .single();
  if (error) throw error;
  return data as { id: string; w_enabled: boolean; updated_at: string };
}
