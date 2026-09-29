import { json } from "@/lib/api";

export const dynamic = "force-dynamic";

export function GET() {
  return json({
    ok: true,
    service: "pip-api",
    databaseConfigured: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY),
  });
}
