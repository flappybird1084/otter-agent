"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

const DEMO_USERS = [
  { email: "alice@demo.local", name: "Alice" },
  { email: "bob@demo.local", name: "Bob" },
  { email: "carol@demo.local", name: "Carol" },
  { email: "dave@demo.local", name: "Dave" },
];

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const demoMode = process.env.NEXT_PUBLIC_DEMO_MODE !== "false";

  async function submit(e: React.FormEvent, em?: string, pw?: string) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: em ?? email, password: pw ?? password }),
    });
    setLoading(false);
    if (res.ok) {
      router.push("/");
      router.refresh();
    } else {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setError(j.error ?? "login failed");
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-sm bg-panel border border-border rounded-lg p-6">
        <h1 className="text-2xl font-semibold mb-4">Confluent</h1>
        <form onSubmit={(e) => submit(e)} className="space-y-3">
          <input
            type="email"
            placeholder="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full bg-panel2 border border-border rounded px-3 py-2"
            required
          />
          <input
            type="password"
            placeholder="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full bg-panel2 border border-border rounded px-3 py-2"
            required
          />
          {error && <div className="text-red-400 text-sm">{error}</div>}
          <button
            disabled={loading}
            className="w-full bg-accent text-bg font-semibold rounded py-2 disabled:opacity-50"
          >
            {loading ? "…" : "Sign in"}
          </button>
        </form>
        <div className="text-sm text-muted mt-3">
          <a href="/signup" className="text-accent hover:underline">Sign up</a>
        </div>
        {demoMode && (
          <div className="mt-6 border-t border-border pt-4">
            <div className="text-xs text-muted mb-2">Demo personas (password: demo)</div>
            <div className="grid grid-cols-2 gap-2">
              {DEMO_USERS.map((u) => (
                <button
                  key={u.email}
                  onClick={(e) => submit(e, u.email, "demo")}
                  className="bg-panel2 border border-border rounded py-2 text-sm hover:bg-border"
                >
                  {u.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
