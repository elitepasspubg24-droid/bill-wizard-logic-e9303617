import { createFileRoute } from "@tanstack/react-router";

// Deletes bill files older than 15 days from the "bills" storage bucket.
// Keeps the bills/bill_items rows so stock qty, last purchase rate, and
// sauda uplifts remain intact — only the uploaded file is removed from cloud.
export const Route = createFileRoute("/api/public/hooks/cleanup-bills")({
  server: {
    handlers: {
      POST: async () => {
        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );

        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 15);
        const cutoffIso = cutoff.toISOString();

        const { data: oldBills, error } = await supabaseAdmin
          .from("bills")
          .select("id, file_path, created_at")
          .not("file_path", "is", null)
          .lt("created_at", cutoffIso);

        if (error) {
          return new Response(
            JSON.stringify({ ok: false, error: error.message }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }

        const paths = (oldBills ?? [])
          .map((b) => b.file_path)
          .filter((p): p is string => !!p);

        let removed = 0;
        if (paths.length) {
          const { error: rmErr } = await supabaseAdmin.storage
            .from("bills")
            .remove(paths);
          if (rmErr) {
            return new Response(
              JSON.stringify({ ok: false, error: rmErr.message }),
              { status: 500, headers: { "Content-Type": "application/json" } },
            );
          }
          removed = paths.length;

          const ids = (oldBills ?? []).map((b) => b.id);
          await supabaseAdmin
            .from("bills")
            .update({ file_path: null })
            .in("id", ids);
        }

        return new Response(
          JSON.stringify({ ok: true, removed, cutoff: cutoffIso }),
          { headers: { "Content-Type": "application/json" } },
        );
      },
    },
  },
});
