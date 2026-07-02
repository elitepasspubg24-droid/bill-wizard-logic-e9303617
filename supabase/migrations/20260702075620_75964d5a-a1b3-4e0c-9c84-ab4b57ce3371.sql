ALTER TABLE public.saudas ADD COLUMN IF NOT EXISTS completed_at timestamptz;

CREATE OR REPLACE FUNCTION public.set_sauda_completed_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.total_qty > 0 AND NEW.lifted_qty >= NEW.total_qty THEN
    IF NEW.completed_at IS NULL THEN
      NEW.completed_at := now();
    END IF;
  ELSE
    NEW.completed_at := NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_set_sauda_completed_at ON public.saudas;
CREATE TRIGGER trg_set_sauda_completed_at
BEFORE INSERT OR UPDATE OF total_qty, lifted_qty ON public.saudas
FOR EACH ROW EXECUTE FUNCTION public.set_sauda_completed_at();

-- Backfill existing fully-lifted saudas
UPDATE public.saudas
SET completed_at = COALESCE(completed_at, now())
WHERE total_qty > 0 AND lifted_qty >= total_qty AND completed_at IS NULL;