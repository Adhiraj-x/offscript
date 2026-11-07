import Link from "next/link";

type Props = {
  streak?: number;
};

export default function Header({ streak }: Props) {
  return (
    <header className="flex items-center justify-between gap-4 py-8">
      <Link href="/" className="flex items-center gap-2.5 text-[15px] font-semibold tracking-tight">
        <span className="h-1.5 w-1.5 rounded-full bg-accent" />
        Offscript
      </Link>
      <nav className="flex items-center gap-5 text-sm text-muted">
        {typeof streak === "number" && streak > 0 ? (
          <span className="text-accent" title="Consecutive days practiced">
            🔥 {streak} day streak
          </span>
        ) : null}
        <Link href="/" className="transition-colors hover:text-white">
          Practice
        </Link>
        <Link href="/history" className="transition-colors hover:text-white">
          History
        </Link>
      </nav>
    </header>
  );
}
