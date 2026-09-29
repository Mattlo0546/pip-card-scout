import { bearerToken, json, messageFromUnknown, options, readObject } from "@/lib/api";
import { DataError, loadWallet, mapWalletCard } from "@/lib/pip-data";
import { getAuthUser, parseSupabaseResponse, restRequest } from "@/lib/supabase-rest";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function OPTIONS() {
  return options();
}

export async function GET(request: Request) {
  const token = bearerToken(request);
  const user = token ? await getAuthUser(token) : null;
  if (!token || !user) return json({ error: "Sign in to view your wallet." }, { status: 401 });

  try {
    return json({ cards: await loadWallet(token, user.id) });
  } catch (error) {
    const status = error instanceof DataError ? error.status : 503;
    return json({ error: error instanceof Error ? error.message : "Your wallet is unavailable." }, { status });
  }
}

export async function POST(request: Request) {
  const token = bearerToken(request);
  const user = token ? await getAuthUser(token) : null;
  if (!token || !user) return json({ error: "Sign in to add a card." }, { status: 401 });

  const body = await readObject(request);
  const productId = body?.productId;
  const nickname = typeof body?.nickname === "string" ? body.nickname.trim() : "";
  const lastFour = typeof body?.lastFour === "string" ? body.lastFour.trim() : "";
  if (typeof productId !== "string" || !UUID.test(productId)) {
    return json({ error: "Choose a valid card product." }, { status: 400 });
  }
  if (nickname.length > 40) return json({ error: "Nickname must be 40 characters or fewer." }, { status: 400 });
  if (lastFour && !/^\d{4}$/.test(lastFour)) return json({ error: "Last four must be exactly four digits." }, { status: 400 });

  try {
    const productResponse = await restRequest(
      `card_products?select=id,comparison_status&id=eq.${productId}&active=eq.true&limit=1`,
      { token },
    );
    const productPayload = await parseSupabaseResponse(productResponse);
    if (!productResponse.ok) {
      return json({ error: messageFromUnknown(productPayload, "The card catalog is unavailable.") }, { status: productResponse.status });
    }
    const product = Array.isArray(productPayload) && productPayload[0] && typeof productPayload[0] === "object"
      ? productPayload[0] as Record<string, unknown>
      : null;
    if (!product) return json({ error: "Choose an active card product from the published catalog." }, { status: 400 });
    const comparisonReady = product.comparison_status !== "catalog_only";

    const response = await restRequest("user_wallet_cards", {
      method: "POST",
      token,
      headers: { Prefer: "return=representation" },
      body: {
        user_id: user.id,
        card_product_id: productId,
        nickname: nickname || null,
        last_four: lastFour || null,
        enabled: comparisonReady,
      },
    });
    const payload = await parseSupabaseResponse(response);
    if (!response.ok) {
      const message = response.status === 409
        ? "That card is already in your wallet."
        : messageFromUnknown(payload, "The card could not be added.");
      return json({ error: message }, { status: response.status });
    }
    const row = Array.isArray(payload) ? payload[0] : null;
    return json({
      card: row && typeof row === "object" ? mapWalletCard(row as Record<string, unknown>) : null,
      comparisonReady,
    }, { status: 201 });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "The card could not be added." }, { status: 503 });
  }
}
