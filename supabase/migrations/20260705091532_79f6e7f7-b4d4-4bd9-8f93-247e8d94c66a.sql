ALTER TABLE public.app_settings ADD COLUMN IF NOT EXISTS sheets_spreadsheet_id text;
ALTER TABLE public.app_settings ADD COLUMN IF NOT EXISTS sheets_last_sync_at timestamptz;
INSERT INTO public.app_settings (id) VALUES ('global') ON CONFLICT (id) DO NOTHING;
GRANT SELECT, INSERT, UPDATE ON public.app_settings TO authenticated;
GRANT ALL ON public.app_settings TO service_role;