import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Retired: global Meta configuration is controlled exclusively through the
// platform-operator boundary. Tenant workspace roles must never rotate global
// provider secrets.
Deno.serve(() =>
  Response.json(
    { error: "function_decommissioned" },
    { status: 410, headers: { "cache-control": "no-store" } }
  )
);
