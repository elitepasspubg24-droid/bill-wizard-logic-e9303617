CREATE OR REPLACE VIEW public.purchase_history AS
SELECT
  bi.item_id,
  bi.rate,
  b.vendor AS vendor_name,
  b.bill_date AS purchase_date,
  b.created_at
FROM public.bill_items bi
JOIN public.bills b ON bi.bill_id = b.id
WHERE b.type = 'purchase';

ALTER VIEW public.purchase_history SET (security_invoker = on);
REVOKE ALL ON public.purchase_history FROM anon;
GRANT SELECT ON public.purchase_history TO authenticated;