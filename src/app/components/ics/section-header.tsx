import { cn } from "../ui/utils";

type SectionHeaderProps = {
  title: string;
  className?: string;
};

export const SectionHeader = ({ title, className }: SectionHeaderProps) => (
  <div className={cn("mb-2 border-b border-border pb-1 text-label-caps text-muted-foreground", className)}>
    {title}
  </div>
);
