import Link from "next/link";

type Props = {
  streak?: number;
};

function FlameIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
    </svg>
  );
}

export default function Header({ streak }: Props) {
  return (
    <header className="flex items-center justify-between gap-4 py-8">
      <Link href="/" className="flex items-center gap-2.5 text-[15px] font-semibold tracking-tight">
        <span className="h-1.5 w-1.5 rounded-full bg-accent" />
        Offscript
      </Link>
      <nav className="flex items-center gap-5 text-sm text-muted">
        {typeof streak === "number" && streak > 0 ? (
          <span
            className="inline-flex items-center gap-1.5 text-accent"
            title="Consecutive days practiced"
          >
            <FlameIcon className="h-3.5 w-3.5" />
            <span>{streak} day streak</span>
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
