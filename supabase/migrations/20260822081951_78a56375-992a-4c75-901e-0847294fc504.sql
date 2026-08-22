CREATE TABLE public.item_aliases (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  alias_key text NOT NULL UNIQUE,
  raw_name text NOT NULL,
  item_id uuid NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX item_aliases_item_id_idx ON public.item_aliases(item_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.item_aliases TO authenticated;
GRANT ALL ON public.item_aliases TO service_role;
ALTER TABLE public.item_aliases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated all" ON public.item_aliases FOR ALL TO authenticated USING (true) WITH CHECK (true);