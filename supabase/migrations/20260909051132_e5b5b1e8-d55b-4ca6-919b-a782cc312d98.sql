ALTER VIEW public.purchase_history SET (security_invoker = on);
REVOKE ALL ON public.purchase_history FROM anon;
GRANT SELECT ON public.purchase_history TO authenticated;