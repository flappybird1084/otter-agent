"use client";
import { useEffect, useState } from "react";

interface Status {
  bridgeEnabled: boolean;
  linked: boolean;
  chatId: string | null;
}

export default function TelegramLinkButton() {
  const [status, setStatus] = useState<Status | null>(null);
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    try {
      const r = await fetch("/api/telegram");
      if (!r.ok) return;
      setStatus((await r.json()) as Status);
    } catch { /* noop */ }
  }

  async function issueCode() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/telegram", { method: "POST" });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        setErr(body.error || `HTTP ${r.status}`);
        setCode(null);
        return;
      }
      const j = (await r.json()) as { code: string };
      setCode(j.code);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // Bridge disabled on server — render nothing rather than a dead button.
  if (status && !status.bridgeEnabled) return null;

  const label = status?.linked ? "Telegram linked" : "Link Telegram";

  return (
    <div style={{ position: "relative" }}>
      <button
        className="tb-btn"
        onClick={() => {
          setOpen((v) => !v);
          if (!status?.linked) void issueCode();
        }}
        title={status?.linked ? `Linked to chat ${status.chatId}` : "Pair this account with your Telegram bot"}
      >
        <span style={{
          width: 18, height: 18, borderRadius: "50%",
          background: status?.linked ? "oklch(0.72 0.14 220)" : "var(--bg-elev)",
          color: status?.linked ? "var(--bg)" : "var(--fg-mute)",
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          fontSize: 10, fontWeight: 700,
          border: "1px solid var(--border-soft)",
        }}>T</span>
        <span>{label}</span>
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 30 }} />
          <div
            style={{
              position: "absolute", top: "calc(100% + 6px)", right: 0,
              zIndex: 31, minWidth: 280,
              background: "var(--bg-elev)", border: "1px solid var(--border)",
              borderRadius: 8, boxShadow: "0 8px 20px rgba(0,0,0,.4)",
              padding: 12, fontSize: 12, lineHeight: 1.5,
              color: "var(--fg)",
            }}
          >
            {status?.linked ? (
              <>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Telegram linked</div>
                <div style={{ color: "var(--fg-mute)" }}>
                  Your agent will message you on Telegram when it needs your
                  input. You can also send messages there — they reach your
                  agent the same way as the chat panel here.
                </div>
                <div style={{ marginTop: 8, color: "var(--fg-faint)", fontFamily: "var(--font-mono)", fontSize: 10 }}>
                  chat id: {status.chatId}
                </div>
              </>
            ) : (
              <>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Link your Telegram</div>
                <ol style={{ margin: "0 0 8px 16px", padding: 0, color: "var(--fg-mute)" }}>
                  <li>Open your Telegram bot in another window.</li>
                  <li>Send it: <code style={{
                    background: "var(--bg)", padding: "1px 6px", borderRadius: 4,
                    fontFamily: "var(--font-mono)",
                  }}>/link {code || "…"}</code></li>
                </ol>
                {err && (
                  <div style={{ color: "oklch(0.78 0.16 25)", marginTop: 6 }}>{err}</div>
                )}
                {code && (
                  <div style={{
                    marginTop: 8, padding: "8px 10px",
                    background: "var(--bg)", borderRadius: 6,
                    fontFamily: "var(--font-mono)", fontSize: 16,
                    letterSpacing: ".15em", textAlign: "center",
                    border: "1px dashed var(--border)",
                  }}>{code}</div>
                )}
                <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
                  <button className="tb-btn" onClick={() => void issueCode()} disabled={busy}>
                    {busy ? "…" : "New code"}
                  </button>
                  <button className="tb-btn" onClick={() => void refresh()}>
                    Check link
                  </button>
                </div>
                <div style={{ marginTop: 8, color: "var(--fg-faint)", fontSize: 10 }}>
                  Code expires in 5 minutes.
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
