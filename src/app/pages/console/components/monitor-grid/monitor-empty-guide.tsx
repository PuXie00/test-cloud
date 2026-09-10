import { Boxes, Cog } from "lucide-react";
import { GoToDevicesButton } from "./go-to-devices-button";

type MonitorEmptyGuideProps = {
  kind?: "object" | "motor";
};

const GUIDE_COPY = {
  object: {
    title: "尚未配置受控物体",
    description: "请先在搭建界面添加主控、电机与受控物体，再回到控制界面查看运行监控。",
    icon: Boxes,
  },
  motor: {
    title: "尚未配置电机",
    description: "请先在搭建界面添加电机，再回到控制界面查看运行监控。",
    icon: Cog,
  },
} as const;

export const MonitorEmptyGuide = ({ kind = "object" }: MonitorEmptyGuideProps) => {
  const { title, description, icon: Icon } = GUIDE_COPY[kind];

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-10 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-md bg-muted">
        <Icon className="h-6 w-6 text-muted-foreground" aria-hidden />
      </div>
      <div className="space-y-1.5">
        <p className="text-body-md font-medium text-foreground">{title}</p>
        <p className="max-w-[220px] text-body-sm text-muted-foreground">{description}</p>
      </div>
      <GoToDevicesButton />
    </div>
  );
};
