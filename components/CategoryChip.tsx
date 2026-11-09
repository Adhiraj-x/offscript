import { CATEGORY_LABEL, normalizeCategory, type TopicCategory } from "@/lib/topics";

type Props = {
  category: TopicCategory | string;
  className?: string;
};

export default function CategoryChip({ category, className = "" }: Props) {
  const canonical = normalizeCategory(category);
  const label = CATEGORY_LABEL[canonical] || canonical;

  return (
    <span
      className={`inline-flex items-center rounded-full border border-line bg-raised/70 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted ${className}`}
    >
      {label}
    </span>
  );
}
