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

export async function fetchItemAliases() {
  const { data, error } = await supabase
    .from("item_aliases")
    .select("alias_key, raw_name, item_id");
  if (error) throw error;
  return data;
}

export async function saveItemAlias(rawName: string, itemId: string, aliasKey: string) {
  const { error } = await supabase
    .from("item_aliases")
    .upsert(
      { alias_key: aliasKey, raw_name: rawName, item_id: itemId },
      { onConflict: "alias_key" },
    );
  if (error) throw error;
}
