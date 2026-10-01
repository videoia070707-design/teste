import "jsr:@supabase/functions-js/edge-runtime.d.ts";

Deno.serve(() =>
  Response.json(
    { error: "diagnostic_retired" },
    { status: 410, headers: { "cache-control": "no-store" } }
  )
);
