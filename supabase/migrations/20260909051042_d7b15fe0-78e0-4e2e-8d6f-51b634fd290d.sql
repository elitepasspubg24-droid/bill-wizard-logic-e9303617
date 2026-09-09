ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_settings FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_settings TO authenticated;
GRANT ALL ON public.app_settings TO service_role;
DROP POLICY IF EXISTS "Authenticated users manage app settings" ON public.app_settings;
CREATE POLICY "Authenticated users manage app settings" ON public.app_settings FOR ALL TO authenticated USING (true) WITH CHECK (true);