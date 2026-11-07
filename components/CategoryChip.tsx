import { CATEGORY_LABEL, type TopicCategory } from "@/lib/topics";

type Props = {
  category: TopicCategory;
  className?: string;
};

export default function CategoryChip({ category, className = "" }: Props) {
  return (
    <span
      className={`inline-flex items-center rounded-full border border-line bg-white/[0.04] px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted ${className}`}
    >
      {CATEGORY_LABEL[category]}
    </span>
  );
}
