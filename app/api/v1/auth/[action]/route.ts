import { bearerToken, json, messageFromUnknown, options, readObject } from "@/lib/api";
import { authRequest, authTokenRequest, parseSupabaseResponse } from "@/lib/supabase-rest";

type Context = { params: Promise<{ action: string }> };

export function OPTIONS() {
  return options();
}

function validEmail(value: unknown): value is string {
  return typeof value === "string" && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function normalizeSession(payload: unknown) {
  if (!payload || typeof payload !== "object") return payload;
  const data = payload as Record<string, unknown>;
  const user = data.user && typeof data.user === "object" ? data.user as Record<string, unknown> : null;
  return {
    accessToken: typeof data.access_token === "string" ? data.access_token : null,
    refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : null,
    expiresAt: Number.isFinite(Number(data.expires_at))
      ? Number(data.expires_at)
      : Math.floor(Date.now() / 1000) + Number(data.expires_in ?? 3600),
    user: user && typeof user.id === "string"
      ? { id: user.id, email: typeof user.email === "string" ? user.email : null }
      : null,
  };
}

export async function POST(request: Request, context: Context) {
  const { action } = await context.params;
  if (action === "sign-out") {
    const token = bearerToken(request);
    if (!token) return json({ error: "No active session." }, { status: 401 });
    try {
      const response = await authTokenRequest("/logout?scope=global", token);
      const payload = await parseSupabaseResponse(response);
      if (!response.ok) return json({ error: messageFromUnknown(payload, "Sign out failed.") }, { status: response.status });
      return json({ ok: true });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Sign out failed." }, { status: 503 });
    }
  }
  const body = await readObject(request);
  if (!body) return json({ error: "Send a JSON request body." }, { status: 400 });

  let path: string;
  let authBody: Record<string, unknown>;

  if (action === "sign-in" || action === "sign-up") {
    if (!validEmail(body.email)) return json({ error: "Enter a valid email address." }, { status: 400 });
    if (typeof body.password !== "string" || body.password.length < 8 || body.password.length > 128) {
      return json({ error: "Password must be between 8 and 128 characters." }, { status: 400 });
    }
    path = action === "sign-in" ? "/token?grant_type=password" : "/signup";
    authBody = { email: body.email.trim().toLowerCase(), password: body.password };
  } else if (action === "refresh") {
    if (typeof body.refreshToken !== "string" || !body.refreshToken) {
      return json({ error: "A refresh token is required." }, { status: 400 });
    }
    path = "/token?grant_type=refresh_token";
    authBody = { refresh_token: body.refreshToken };
  } else {
    return json({ error: "Unknown auth action." }, { status: 404 });
  }

  try {
    const response = await authRequest(path, authBody);
    const payload = await parseSupabaseResponse(response);
    if (!response.ok) {
      return json({ error: messageFromUnknown(payload, "Authentication failed.") }, { status: response.status });
    }
    const session = normalizeSession(payload) as Record<string, unknown>;
    return json({
      session,
      emailConfirmationRequired: action === "sign-up" && !session.accessToken,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Authentication is unavailable." }, { status: 503 });
  }
}
