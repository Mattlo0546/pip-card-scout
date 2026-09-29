import { bearerToken, json, messageFromUnknown, options, readObject } from "@/lib/api";
import { getAuthUser, parseSupabaseResponse, restRequest } from "@/lib/supabase-rest";

type Context = { params: Promise<{ id: string }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function OPTIONS() {
  return options();
}

async function authorize(request: Request) {
  const token = bearerToken(request);
  const user = token ? await getAuthUser(token) : null;
  return { token, user };
}

export async function PATCH(request: Request, context: Context) {
  const { token, user } = await authorize(request);
  if (!token || !user) return json({ error: "Sign in to update your wallet." }, { status: 401 });
  const { id } = await context.params;
  if (!UUID.test(id)) return json({ error: "Invalid wallet card." }, { status: 400 });
  const body = await readObject(request);
  if (!body || typeof body.enabled !== "boolean") return json({ error: "Send an enabled value." }, { status: 400 });

  try {
    const response = await restRequest(`user_wallet_cards?id=eq.${id}&user_id=eq.${user.id}`, {
      method: "PATCH",
      token,
      headers: { Prefer: "return=minimal" },
      body: { enabled: body.enabled },
    });
    const payload = await parseSupabaseResponse(response);
    if (!response.ok) return json({ error: messageFromUnknown(payload, "The card could not be updated.") }, { status: response.status });
    return json({ ok: true });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "The card could not be updated." }, { status: 503 });
  }
}

export async function DELETE(request: Request, context: Context) {
  const { token, user } = await authorize(request);
  if (!token || !user) return json({ error: "Sign in to update your wallet." }, { status: 401 });
  const { id } = await context.params;
  if (!UUID.test(id)) return json({ error: "Invalid wallet card." }, { status: 400 });

  try {
    const response = await restRequest(`user_wallet_cards?id=eq.${id}&user_id=eq.${user.id}`, {
      method: "DELETE",
      token,
      headers: { Prefer: "return=minimal" },
    });
    const payload = await parseSupabaseResponse(response);
    if (!response.ok) return json({ error: messageFromUnknown(payload, "The card could not be removed.") }, { status: response.status });
    return json({ ok: true });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "The card could not be removed." }, { status: 503 });
  }
}
