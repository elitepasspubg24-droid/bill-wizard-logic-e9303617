import { createFileRoute } from "@tanstack/react-router";

// Deletes saudas that have been fully lifted (pending = 0) for 7+ days.
// Cascade removes sauda_items and sauda_uplifts via FK, and history is
// no longer needed once the sauda is closed out.
export const Route = createFileRoute("/api/public/hooks/cleanup-saudas")({
  server: {
    handlers: {
      POST: async () => {
        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );

        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 7);
        const cutoffIso = cutoff.toISOString();

        const { data: old, error } = await supabaseAdmin
          .from("saudas")
          .select("id, completed_at")
          .not("completed_at", "is", null)
          .lt("completed_at", cutoffIso);

        if (error) {
          return new Response(
            JSON.stringify({ ok: false, error: error.message }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }

        const ids = (old ?? []).map((s) => s.id);
        let removed = 0;
        if (ids.length) {
          await supabaseAdmin.from("sauda_uplifts").delete().in("sauda_id", ids);
          await supabaseAdmin.from("sauda_items").delete().in("sauda_id", ids);
          const { error: delErr } = await supabaseAdmin
            .from("saudas")
            .delete()
            .in("id", ids);
          if (delErr) {
            return new Response(
              JSON.stringify({ ok: false, error: delErr.message }),
              { status: 500, headers: { "Content-Type": "application/json" } },
            );
          }
          removed = ids.length;
        }

        return new Response(
          JSON.stringify({ ok: true, removed, cutoff: cutoffIso }),
          { headers: { "Content-Type": "application/json" } },
        );
      },
    },
  },
});
