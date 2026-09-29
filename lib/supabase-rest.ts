import "server-only";

type RequestOptions = {
  method?: string;
  body?: unknown;
  token?: string;
  headers?: Record<string, string>;
};

function config() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY.");
  }
  return { url, anonKey };
}

function adminConfig() {
  const { url } = config();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured.");
  return { url, serviceKey };
}

async function request(path: string, options: RequestOptions = {}) {
  const { url, anonKey } = config();
  return fetch(`${url}${path}`, {
    method: options.method ?? "GET",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${options.token ?? anonKey}`,
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...options.headers,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: "no-store",
  });
}

export async function authRequest(path: string, body: unknown) {
  return request(`/auth/v1${path}`, { method: "POST", body });
}

export async function authTokenRequest(path: string, token: string) {
  return request(`/auth/v1${path}`, { method: "POST", token });
}

export async function getAuthUser(token: string): Promise<{ id: string; email: string | null } | null> {
  const response = await request("/auth/v1/user", { token });
  if (!response.ok) return null;
  const user = await response.json() as { id?: unknown; email?: unknown };
  return typeof user.id === "string"
    ? { id: user.id, email: typeof user.email === "string" ? user.email : null }
    : null;
}

export async function restRequest(path: string, options: RequestOptions = {}) {
  return request(`/rest/v1/${path}`, options);
}

export async function adminRestRequest(path: string, options: Omit<RequestOptions, "token"> = {}) {
  const { url, serviceKey } = adminConfig();
  return fetch(`${url}/rest/v1/${path}`, {
    method: options.method ?? "GET",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...options.headers,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: "no-store",
  });
}

export async function adminAuthRequest(path: string, options: Omit<RequestOptions, "token"> = {}) {
  const { url, serviceKey } = adminConfig();
  return fetch(`${url}/auth/v1${path}`, {
    method: options.method ?? "GET",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...options.headers,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: "no-store",
  });
}

export async function parseSupabaseResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: text };
  }
}
