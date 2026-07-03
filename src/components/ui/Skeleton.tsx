import { cn } from "@/lib/utils";
import { HTMLAttributes } from "react";

interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  /** Preset shapes matching common UI blocks */
  variant?: "text" | "title" | "avatar" | "card" | "stat";
}

const variantClasses: Record<NonNullable<SkeletonProps["variant"]>, string> = {
  text: "h-4 w-full rounded-md",
  title: "h-7 w-2/3 rounded-lg",
  avatar: "h-11 w-11 rounded-xl",
  card: "h-32 w-full rounded-xl",
  stat: "h-24 w-full rounded-2xl",
};

export function Skeleton({
  variant = "text",
  className,
  ...props
}: SkeletonProps) {
  return (
    <div
      className={cn("mc-skeleton", variantClasses[variant], className)}
      aria-hidden="true"
      {...props}
    />
  );
}

export function SkeletonStatGrid({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} variant="stat" />
      ))}
    </div>
  );
}
