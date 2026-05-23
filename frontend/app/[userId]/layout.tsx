import Link from "next/link";

export default function UserLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { userId: string };
}) {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="h-12 border-b border-zinc-900 flex items-center justify-between px-4 text-sm">
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="font-semibold tracking-tight hover:text-white text-zinc-300"
          >
            Confluent
          </Link>
          <span className="text-zinc-600">/</span>
          <span className="text-zinc-400">{params.userId}</span>
        </div>
        <nav className="flex items-center gap-4 text-zinc-400">
          <Link href={`/${params.userId}`} className="hover:text-white">
            Home
          </Link>
          <Link
            href={`/${params.userId}/friends`}
            className="hover:text-white"
          >
            Friends
          </Link>
          <Link href="/" className="hover:text-white">
            Switch user
          </Link>
        </nav>
      </header>
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  );
}
