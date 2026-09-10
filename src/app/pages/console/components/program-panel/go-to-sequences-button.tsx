import { ArrowRight, List } from "lucide-react";
import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/components/ui/utils";
import { useConsoleNav } from "../../hooks/use-console-nav";

type GoToSequencesButtonProps = {
  className?: string;
  size?: "sm" | "md";
};

export const GoToSequencesButton = ({ className, size = "md" }: GoToSequencesButtonProps) => {
  const { navigate } = useConsoleNav();

  const handleClick = () => navigate("sequences");

  return (
    <Button
      type="button"
      variant="default"
      size={size === "sm" ? "sm" : "lg"}
      onClick={handleClick}
      aria-label="前往动作界面编排"
      className={cn(
        "normal-case tracking-normal font-semibold text-body-sm text-primary-foreground",
        "[&_svg]:text-primary-foreground",
        className,
      )}
    >
      <List className="h-4 w-4 shrink-0" aria-hidden />
      前往动作界面编排
      <ArrowRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
    </Button>
  );
};
