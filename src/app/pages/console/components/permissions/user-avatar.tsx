import { cn } from "@/app/components/ui/utils";

type UserAvatarProps = {
  name: string;
  variant?: "list" | "detail";
  selected?: boolean;
  className?: string;
};

export const UserAvatar = ({
  name,
  variant = "list",
  selected = false,
  className,
}: UserAvatarProps) => {
  const initial = name.charAt(0);

  if (variant === "detail") {
    return (
      <span
        className={cn(
          "flex h-14 w-14 shrink-0 items-center justify-center rounded-lg",
          "bg-secondary-foreground text-heading-lg font-semibold text-white",
          className,
        )}
        aria-hidden
      >
        {initial}
      </span>
    );
  }

  return (
    <span
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-body-sm font-semibold",
        selected
          ? "bg-secondary-foreground text-white"
          : "bg-accent text-foreground",
        className,
      )}
      aria-hidden
    >
      {initial}
    </span>
  );
};
