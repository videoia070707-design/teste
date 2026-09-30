export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return Response.json(
    { status: "ok", service: "web", check: "liveness" },
    {
      status: 200,
      headers: {
        "cache-control": "no-store"
      }
    }
  );
}
