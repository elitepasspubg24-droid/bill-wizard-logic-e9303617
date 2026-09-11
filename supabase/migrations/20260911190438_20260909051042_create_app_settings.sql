CREATE TABLE public.app_settings (
  id text PRIMARY KEY DEFAULT 'global',
  w_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  sheets_spreadsheet_id text,
  sheets_last_sync_at timestamptz
);
INSERT INTO public.app_settings (id) VALUES ('global') ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_settings FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_settings TO authenticated;
GRANT ALL ON public.app_settings TO service_role;
DROP POLICY IF EXISTS "Authenticated users manage app settings" ON public.app_settings;
CREATE POLICY "Authenticated users manage app settings" ON public.app_settings FOR ALL TO authenticated USING (true) WITH CHECK (true);