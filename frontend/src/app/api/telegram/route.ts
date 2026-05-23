/**
 * Telegram pairing proxy.
 *
 *   GET   -> { bridgeEnabled, linked, chatId }
 *   POST  -> { code, expiresInSeconds }   issues a fresh 5-min link code
 *
 * The bot itself runs in the FastAPI process; this route just exposes the
 * pairing handshake to the browser.
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { api } from "@/lib/api-server";

export async function GET() {
  try {
    const user = await requireUser();
    const s = await api.telegramStatus(user.id);
    return NextResponse.json({
      bridgeEnabled: s.bridge_enabled,
      linked: s.linked,
      chatId: s.chat_id,
    });
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
}

export async function POST() {
  try {
    const user = await requireUser();
    const r = await api.telegramLinkCode(user.id);
    return NextResponse.json({
      code: r.code,
      expiresInSeconds: r.expires_in_seconds,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Surface the 503 from the backend (TELEGRAM_BOT_TOKEN unset) as a
    // structured error the UI can display.
    const status = msg.includes("503") ? 503 : 401;
    return NextResponse.json({ error: msg }, { status });
  }
}
