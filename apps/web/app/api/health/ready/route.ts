import { getDatabase } from "@/lib/server/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const sql = getDatabase();
    await sql`select 1 as ready`;

    return Response.json(
      { status: "ready", service: "web", check: "database" },
      {
        status: 200,
        headers: {
          "cache-control": "no-store"
        }
      }
    );
  } catch {
    return Response.json(
      { status: "not_ready", service: "web", check: "database" },
      {
        status: 503,
        headers: {
          "cache-control": "no-store"
        }
      }
    );
  }
}
