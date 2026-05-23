"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password, displayName }),
    });
    if (res.ok) {
      router.push("/");
      router.refresh();
    } else {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setError(j.error ?? "signup failed");
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-sm bg-panel border border-border rounded-lg p-6">
        <h1 className="text-2xl font-semibold mb-4">Create account</h1>
        <form onSubmit={submit} className="space-y-3">
          <input
            placeholder="display name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full bg-panel2 border border-border rounded px-3 py-2"
            required
          />
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
          <button className="w-full bg-accent text-bg font-semibold rounded py-2">
            Sign up
          </button>
        </form>
        <div className="text-sm text-muted mt-3">
          <a href="/login" className="text-accent hover:underline">Sign in</a>
        </div>
      </div>
    </main>
  );
}
