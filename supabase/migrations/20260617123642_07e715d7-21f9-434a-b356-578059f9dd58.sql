
CREATE POLICY "bills bucket open all"
ON storage.objects FOR ALL
USING (bucket_id = 'bills')
WITH CHECK (bucket_id = 'bills');
