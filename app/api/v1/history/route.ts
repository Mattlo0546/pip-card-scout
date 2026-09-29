import { bearerToken, json, messageFromUnknown, options } from "@/lib/api";
import { getAuthUser, parseSupabaseResponse, restRequest } from "@/lib/supabase-rest";

export function OPTIONS() {
  return options();
}

export async function GET(request: Request) {
  const token = bearerToken(request);
  const user = token ? await getAuthUser(token) : null;
  if (!token || !user) return json({ error: "Sign in to view recommendation history." }, { status: 401 });

  try {
    const response = await restRequest(
      `recommendation_events?select=id,merchant,category,amount_pence,currency,estimated_value_pence,explanation,created_at&user_id=eq.${user.id}&order=created_at.desc&limit=12`,
      { token },
    );
    const payload = await parseSupabaseResponse(response);
    if (!response.ok) return json({ error: messageFromUnknown(payload, "History is unavailable.") }, { status: response.status });
    const events = Array.isArray(payload) ? payload.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as Record<string, unknown>;
      const explanation = row.explanation && typeof row.explanation === "object"
        ? row.explanation as Record<string, unknown>
        : null;
      const winner = explanation?.winner && typeof explanation.winner === "object"
        ? explanation.winner as Record<string, unknown>
        : null;
      return [{
        id: typeof row.id === "string" ? row.id : "",
        merchant: typeof row.merchant === "string" ? row.merchant : "Merchant",
        category: typeof row.category === "string" ? row.category : "general",
        amountPence: Number(row.amount_pence ?? 0),
        currency: typeof row.currency === "string" ? row.currency : "GBP",
        estimatedValuePence: Number(row.estimated_value_pence ?? 0),
        cardName: typeof winner?.cardName === "string" ? winner.cardName : "Wallet card",
        createdAt: typeof row.created_at === "string" ? row.created_at : null,
      }];
    }) : [];
    return json({ events });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "History is unavailable." }, { status: 503 });
  }
}
