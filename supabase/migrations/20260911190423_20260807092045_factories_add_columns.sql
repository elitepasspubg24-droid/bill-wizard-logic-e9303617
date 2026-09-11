ALTER TABLE public.factories ADD COLUMN IF NOT EXISTS adder numeric NOT NULL DEFAULT 0;
ALTER TABLE public.factories ADD COLUMN IF NOT EXISTS party_adder numeric NOT NULL DEFAULT 0;
ALTER TABLE public.factories ADD COLUMN IF NOT EXISTS w text;
ALTER TABLE public.factories ADD COLUMN IF NOT EXISTS w_adder text NOT NULL DEFAULT '';