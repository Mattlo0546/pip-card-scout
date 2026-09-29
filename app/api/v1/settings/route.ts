import { bearerToken, json, messageFromUnknown, options, readObject } from "@/lib/api";
import { getAuthUser, parseSupabaseResponse, restRequest } from "@/lib/supabase-rest";

export function OPTIONS() {
  return options();
}

async function auth(request: Request) {
  const token = bearerToken(request);
  const user = token ? await getAuthUser(token) : null;
  return { token, user };
}

export async function GET(request: Request) {
  const { token, user } = await auth(request);
  if (!token || !user) return json({ error: "Sign in to view settings." }, { status: 401 });

  try {
    const response = await restRequest(
      `user_settings?select=cloud_history,retention_days&user_id=eq.${user.id}&limit=1`,
      { token },
    );
    const payload = await parseSupabaseResponse(response);
    if (!response.ok) return json({ error: messageFromUnknown(payload, "Settings are unavailable.") }, { status: response.status });
    const row = Array.isArray(payload) && payload[0] && typeof payload[0] === "object"
      ? payload[0] as Record<string, unknown>
      : null;
    return json({
      settings: {
        cloudHistory: Boolean(row?.cloud_history),
        retentionDays: Number(row?.retention_days ?? 90),
      },
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Settings are unavailable." }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  const { token, user } = await auth(request);
  if (!token || !user) return json({ error: "Sign in to update settings." }, { status: 401 });
  const body = await readObject(request);
  if (!body || typeof body.cloudHistory !== "boolean") {
    return json({ error: "Send a cloudHistory boolean." }, { status: 400 });
  }

  try {
    const response = await restRequest("user_settings", {
      method: "POST",
      token,
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: { user_id: user.id, cloud_history: body.cloudHistory },
    });
    const payload = await parseSupabaseResponse(response);
    if (!response.ok) return json({ error: messageFromUnknown(payload, "Settings could not be updated.") }, { status: response.status });
    return json({ settings: { cloudHistory: body.cloudHistory } });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Settings could not be updated." }, { status: 503 });
  }
}
