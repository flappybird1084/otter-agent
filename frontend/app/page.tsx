"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { User } from "@/lib/types";

export default function LandingPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listUsers()
      .then(setUsers)
      .catch((e) => setError(String(e)));
  }, []);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8">
      <div className="max-w-2xl w-full">
        <div className="mb-12 text-center">
          <h1 className="text-5xl font-semibold tracking-tight mb-3">
            Confluent
          </h1>
          <p className="text-zinc-400 text-lg">
            Your agent has friends. Pick a user to sign in as.
          </p>
        </div>

        {error && (
          <div className="mb-6 rounded-md border border-red-900/50 bg-red-950/30 p-4 text-sm text-red-300">
            Couldn&apos;t reach backend: {error}
            <div className="mt-2 text-zinc-400">
              Is it running at{" "}
              <code className="font-mono text-xs">
                {process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080"}
              </code>
              ?
            </div>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          {users.map((u) => (
            <Link
              key={u.id}
              href={`/${u.id}`}
              className="group rounded-xl border border-zinc-800 bg-zinc-950 p-5 hover:border-zinc-600 hover:bg-zinc-900 transition"
            >
              <div className="text-4xl mb-2">{u.avatar_emoji}</div>
              <div className="font-medium">{u.display_name}</div>
              <div className="text-xs text-zinc-500">{u.handle}</div>
              <div className="mt-2 text-xs text-zinc-400 line-clamp-2">
                {u.bio}
              </div>
            </Link>
          ))}
          {users.length === 0 && !error && (
            <div className="col-span-3 text-center text-zinc-500 text-sm py-10">
              Loading users…
            </div>
          )}
        </div>

        <div className="mt-10 text-xs text-zinc-600 text-center">
          Tip: open two browser windows side-by-side, sign in as Maya and Priya,
          and watch the graph.
        </div>
      </div>
    </main>
  );
}
