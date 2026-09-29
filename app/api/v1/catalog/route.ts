import { bearerToken, json, options } from "@/lib/api";
import { DataError, loadCatalog } from "@/lib/pip-data";
import { getAuthUser } from "@/lib/supabase-rest";

export function OPTIONS() {
  return options();
}

export async function GET(request: Request) {
  const token = bearerToken(request);
  if (!token || !(await getAuthUser(token))) return json({ error: "Sign in to view the card catalog." }, { status: 401 });

  try {
    return json({ products: await loadCatalog(token) });
  } catch (error) {
    const status = error instanceof DataError ? error.status : 503;
    return json({ error: error instanceof Error ? error.message : "The catalog is unavailable." }, { status });
  }
}
