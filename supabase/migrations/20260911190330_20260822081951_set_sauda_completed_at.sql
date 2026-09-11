CREATE OR REPLACE FUNCTION public.set_sauda_completed_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF (NEW.total_qty > 0 AND NEW.lifted_qty >= NEW.total_qty) OR NEW.status = 'done' THEN
    IF NEW.completed_at IS NULL THEN
      NEW.completed_at := now();
    END IF;
  ELSE
    NEW.completed_at := NULL;
  END IF;
  RETURN NEW;
END
$$;