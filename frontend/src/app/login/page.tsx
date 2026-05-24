"use client";

import { useEffect, useState } from "react";

interface User {
  id: string;
  display_name: string;
  handle: string;
  avatar_emoji: string;
  bio: string;
}

export default function LoginPage() {
  const [users, setUsers] = useState<User[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const base = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8080";
    fetch(`${base}/users`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.statusText)))
      .then((j: User[]) => setUsers(j))
      .catch((e) => setError(String(e)));
  }, []);

  async function signIn(userId: string) {
    setBusy(userId);
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (!r.ok) {
        setError(`login failed: ${r.statusText}`);
        return;
      }
      window.location.href = "/";
    } finally {
      setBusy(null);
    }
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "32px",
        background: "var(--bg)",
        color: "var(--fg)",
        fontFamily: "var(--font-sans, system-ui)",
      }}
    >
      <div style={{ width: "100%", maxWidth: 720 }}>
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <h1 style={{ fontSize: 44, fontWeight: 600, margin: 0, letterSpacing: "-0.01em" }}>
            otterbox
          </h1>
          <p style={{ color: "var(--fg-mute, #888)", marginTop: 8 }}>
            Pick a user to sign in as.
          </p>
        </div>

        {error && (
          <div
            style={{
              marginBottom: 16,
              padding: 12,
              borderRadius: 8,
              background: "rgba(239,68,68,.1)",
              border: "1px solid rgba(239,68,68,.3)",
              color: "#fca5a5",
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: 14,
          }}
        >
          {users === null && !error && (
            <div style={{ gridColumn: "1 / -1", textAlign: "center", color: "var(--fg-faint, #555)", fontSize: 13 }}>
              Loading users…
            </div>
          )}
          {users?.map((u) => (
            <button
              key={u.id}
              onClick={() => signIn(u.id)}
              disabled={busy !== null}
              style={{
                textAlign: "left",
                padding: 18,
                borderRadius: 12,
                border: "1px solid var(--border, #2a2a30)",
                background: busy === u.id ? "var(--bg-elev, #18181b)" : "var(--bg-elev, #0f0f12)",
                color: "var(--fg)",
                cursor: busy ? "wait" : "pointer",
                opacity: busy && busy !== u.id ? 0.5 : 1,
              }}
            >
              <div style={{ fontSize: 30, marginBottom: 6 }}>{u.avatar_emoji}</div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{u.display_name}</div>
              <div style={{ fontSize: 11, color: "var(--fg-faint, #666)" }}>{u.handle}</div>
              <div style={{ fontSize: 12, color: "var(--fg-mute, #999)", marginTop: 6, lineHeight: 1.35 }}>
                {u.bio}
              </div>
            </button>
          ))}
        </div>

        <div
          style={{
            marginTop: 32,
            fontSize: 11,
            color: "var(--fg-faint, #555)",
            textAlign: "center",
          }}
        >
          Two-tab demo: open another window and sign in as a different user.
        </div>
      </div>
    </main>
  );
}
