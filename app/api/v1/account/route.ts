import { bearerToken, json, messageFromUnknown, options } from "@/lib/api";
import { adminAuthRequest, getAuthUser, parseSupabaseResponse } from "@/lib/supabase-rest";

export function OPTIONS() {
  return options();
}

export async function DELETE(request: Request) {
  const token = bearerToken(request);
  const user = token ? await getAuthUser(token) : null;
  if (!token || !user) return json({ error: "Sign in before deleting your account." }, { status: 401 });

  try {
    const response = await adminAuthRequest(`/admin/users/${encodeURIComponent(user.id)}`, { method: "DELETE" });
    const payload = await parseSupabaseResponse(response);
    if (!response.ok) {
      return json({ error: messageFromUnknown(payload, "Your account could not be deleted.") }, { status: response.status });
    }
    return json({ deleted: true });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Your account could not be deleted." }, { status: 503 });
  }
}
