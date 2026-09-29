import "server-only";

const CORS_HEADERS = {
  // Pip uses bearer tokens rather than cookies. A wildcard is intentional so
  // unpacked GitHub installs, whose chrome-extension:// IDs vary, can use the API.
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Cache-Control": "no-store",
};

export function json(data: unknown, init: ResponseInit = {}): Response {
  return Response.json(data, {
    ...init,
    headers: { ...CORS_HEADERS, ...init.headers },
  });
}

export function options(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export function bearerToken(request: Request): string | null {
  const value = request.headers.get("authorization") ?? "";
  const [scheme, token] = value.split(" ");
  return scheme?.toLowerCase() === "bearer" && token ? token : null;
}

export async function readObject(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > 32_768) return null;
    const raw = await request.text();
    if (!raw || raw.length > 32_768) return null;
    const body: unknown = JSON.parse(raw);
    return body && typeof body === "object" && !Array.isArray(body)
      ? body as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export function messageFromUnknown(value: unknown, fallback: string): string {
  if (!value || typeof value !== "object") return fallback;
  const candidate = value as Record<string, unknown>;
  for (const key of ["message", "msg", "error_description", "error", "hint"]) {
    if (typeof candidate[key] === "string" && candidate[key]) return candidate[key];
  }
  return fallback;
}
