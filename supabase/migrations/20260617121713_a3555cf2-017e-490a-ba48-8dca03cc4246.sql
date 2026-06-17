CREATE TABLE public.factories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  basic_rate NUMERIC NOT NULL DEFAULT 0,
  position INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  factory_id UUID NOT NULL REFERENCES public.factories(id) ON DELETE RESTRICT,
  adder NUMERIC NOT NULL DEFAULT 0,
  party_basic NUMERIC NOT NULL DEFAULT 0,
  sauda_basic NUMERIC NOT NULL DEFAULT 0,
  position INT NOT NULL DEFAULT 0
);

CREATE TABLE public.items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id UUID NOT NULL REFERENCES public.sections(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  gauge_diff NUMERIC NOT NULL DEFAULT 0,
  available_qty NUMERIC NOT NULL DEFAULT 0,
  last_purchase_rate NUMERIC,
  position INT NOT NULL DEFAULT 0
);
CREATE INDEX items_section_idx ON public.items(section_id);

CREATE TABLE public.bills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN ('purchase','sale')),
  file_path TEXT,
  vendor TEXT,
  bill_no TEXT,
  bill_date DATE,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'confirmed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.bill_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id UUID NOT NULL REFERENCES public.bills(id) ON DELETE CASCADE,
  item_id UUID REFERENCES public.items(id) ON DELETE SET NULL,
  raw_name TEXT,
  qty NUMERIC NOT NULL DEFAULT 0,
  rate NUMERIC NOT NULL DEFAULT 0
);
CREATE INDEX bill_items_bill_idx ON public.bill_items(bill_id);

CREATE TABLE public.saudas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  party_name TEXT NOT NULL,
  factory_id UUID REFERENCES public.factories(id) ON DELETE SET NULL,
  sauda_basic NUMERIC NOT NULL DEFAULT 0,
  sauda_date DATE NOT NULL DEFAULT CURRENT_DATE,
  notes TEXT,
  linked_bill_id UUID REFERENCES public.bills(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.sauda_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sauda_id UUID NOT NULL REFERENCES public.saudas(id) ON DELETE CASCADE,
  item_id UUID REFERENCES public.items(id) ON DELETE SET NULL,
  raw_name TEXT,
  qty NUMERIC NOT NULL DEFAULT 0,
  rate NUMERIC NOT NULL DEFAULT 0
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.factories TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sections TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bills TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bill_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.saudas TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sauda_items TO authenticated;
GRANT ALL ON public.factories, public.sections, public.items, public.bills, public.bill_items, public.saudas, public.sauda_items TO service_role;

ALTER TABLE public.factories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bill_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saudas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sauda_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth all" ON public.factories FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth all" ON public.sections  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth all" ON public.items     FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth all" ON public.bills     FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth all" ON public.bill_items FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth all" ON public.saudas    FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth all" ON public.sauda_items FOR ALL TO authenticated USING (true) WITH CHECK (true);