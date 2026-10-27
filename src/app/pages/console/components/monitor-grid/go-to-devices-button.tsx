import { ArrowRight, Cpu } from "lucide-react";
import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/components/ui/utils";
import { useConsoleNav } from "../../hooks/use-console-nav";
import { usePermissions } from "@/app/auth/permissions";

type GoToDevicesButtonProps = {
  className?: string;
  size?: "sm" | "md";
};

export const GoToDevicesButton = ({ className, size = "md" }: GoToDevicesButtonProps) => {
  const { navigate } = useConsoleNav();
  // 跳到配置向导，要「编辑工程配置」；没有就不显示
  const allowed = usePermissions().can("build.edit");

  const handleClick = () => navigate("devices", { devicesTab: "wizard" });

  if (!allowed) return null;

  return (
    <Button
      type="button"
      variant="default"
      size={size === "sm" ? "sm" : "lg"}
      onClick={handleClick}
      aria-label="前往搭建界面配置"
      className={cn(
        "normal-case tracking-normal font-semibold text-body-sm text-primary-foreground",
        "[&_svg]:text-primary-foreground",
        className,
      )}
    >
      <Cpu className="h-4 w-4 shrink-0" aria-hidden />
      前往搭建界面配置
      <ArrowRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
    </Button>
  );
};
