
-- Switch all business RLS policies from anon (public) to authenticated only.

-- Helper: drop and recreate each policy scoped to authenticated with same rule.
DROP POLICY IF EXISTS "open" ON public.bills;
CREATE POLICY "authenticated all" ON public.bills FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "open" ON public.bill_items;
CREATE POLICY "authenticated all" ON public.bill_items FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "open" ON public.factories;
CREATE POLICY "authenticated all" ON public.factories FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "open" ON public.factory_rate_history;
CREATE POLICY "authenticated all" ON public.factory_rate_history FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "open" ON public.items;
CREATE POLICY "authenticated all" ON public.items FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "open" ON public.sauda_items;
CREATE POLICY "authenticated all" ON public.sauda_items FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "open" ON public.sauda_uplifts;
CREATE POLICY "authenticated all" ON public.sauda_uplifts FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "open" ON public.saudas;
CREATE POLICY "authenticated all" ON public.saudas FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "open" ON public.section_rate_history;
CREATE POLICY "authenticated all" ON public.section_rate_history FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "open" ON public.sections;
CREATE POLICY "authenticated all" ON public.sections FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Grants: revoke anon, keep authenticated + service_role
REVOKE ALL ON public.bills, public.bill_items, public.factories, public.factory_rate_history,
              public.items, public.sauda_items, public.sauda_uplifts, public.saudas,
              public.section_rate_history, public.sections
       FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.bills, public.bill_items, public.factories, public.factory_rate_history,
  public.items, public.sauda_items, public.sauda_uplifts, public.saudas,
  public.section_rate_history, public.sections
TO authenticated;

-- Storage: restrict bills bucket to authenticated
DROP POLICY IF EXISTS "bills bucket open all" ON storage.objects;
CREATE POLICY "bills bucket authenticated all"
  ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'bills')
  WITH CHECK (bucket_id = 'bills');
