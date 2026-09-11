CREATE TABLE public.whatsapp_allowed_numbers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL UNIQUE,
  label text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_allowed_numbers TO authenticated;
GRANT ALL ON public.whatsapp_allowed_numbers TO service_role;
ALTER TABLE public.whatsapp_allowed_numbers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated all" ON public.whatsapp_allowed_numbers FOR ALL TO authenticated USING (true) WITH CHECK (true);