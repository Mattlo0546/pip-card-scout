import { json } from "@/lib/api";

export const dynamic = "force-dynamic";

export function GET() {
  return json({
    ok: true,
    service: "Pip Chrome Extension API",
    purpose: "Authentication, card catalogue, wallet, and reward recommendations for the Pip extension.",
    install: "https://github.com/Mattlo0546/pip-card-scout/releases/latest",
    health: "https://pip-card-scout.vercel.app/api/health",
  });
}
