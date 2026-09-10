import { Button } from "@/app/components/ui/button";
import { Progress } from "@/app/components/ui/progress";
import { Slider } from "@/app/components/ui/slider";
import { cn } from "@/app/components/ui/utils";
import { CALIBRATION_PLACEHOLDER, KEYBOARD_ROWS } from "../system-settings-constants";
import { SettingsSection } from "../settings-section";

const { brightness, faderValue, pressedKeys, systemTime } = CALIBRATION_PLACEHOLDER;
const pressedSet = new Set<string>(pressedKeys);

const KeyButton = ({ label, wide }: { label: string; wide?: boolean }) => {
  const pressed = pressedSet.has(label);
  return (
    <div
      className={cn(
        "flex h-9 items-center justify-center rounded-sm text-body-sm font-medium",
        wide ? "min-w-[72px] px-4" : "min-w-[36px] px-2",
        pressed ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
      )}
    >
      {label}
    </div>
  );
};

export const CalibrationPanel = () => (
  <div className="flex max-w-3xl flex-col gap-8">
    <SettingsSection title="屏幕亮度">
      <div className="flex items-center gap-4">
        <Slider defaultValue={[brightness]} max={100} step={1} className="flex-1" />
        <span className="w-12 shrink-0 text-right font-mono text-mono-sm tabular-nums text-primary">
          {brightness}%
        </span>
      </div>
    </SettingsSection>

    <SettingsSection title="按键测试">
      <div className="flex flex-col gap-2">
        {KEYBOARD_ROWS.map((row) => (
          <div key={row.join("-")} className="flex flex-wrap gap-1.5">
            {row.map((key) => (
              <KeyButton key={key} label={key} />
            ))}
          </div>
        ))}
        <div className="mt-1 flex flex-wrap gap-1.5">
          <KeyButton label="SHIFT" wide />
          <KeyButton label="SPACE" wide />
          <KeyButton label="ENTER" wide />
        </div>
      </div>
      <p className="text-body-sm text-muted-foreground">按下任意按键进行测试</p>
    </SettingsSection>

    <SettingsSection title="旋钮/推子/摇杆 校准">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-body-md text-foreground">
              推子-1 <span className="text-muted-foreground">速度控制</span>
            </span>
            <span className="font-mono text-mono-sm tabular-nums text-primary">{faderValue}%</span>
          </div>
          <Progress value={faderValue} className="h-2" />
          <Button type="button" variant="ghost" size="sm" className="self-start">
            重置校准
          </Button>
        </div>

        <div className="flex items-center justify-between gap-4">
          <span className="text-body-md text-foreground">
            旋钮-1 <span className="text-muted-foreground">速度微调</span>
          </span>
          <div className="flex items-center gap-4">
            <div
              className="relative h-14 w-14 rounded-full border-2 border-primary/40 bg-muted"
              aria-hidden
            >
              <div className="absolute inset-2 rounded-full border border-primary/30" />
            </div>
            <Button type="button" variant="ghost" size="sm">
              重置
            </Button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-4">
          <span className="text-body-md text-foreground">
            摇杆 <span className="text-muted-foreground">方向控制</span>
          </span>
          <div className="flex items-center gap-4">
            <div
              className="relative flex h-20 w-20 items-center justify-center rounded-md bg-muted"
              aria-hidden
            >
              <div className="absolute inset-3 rounded-full border border-primary/20" />
              <div className="h-3 w-3 rounded-full bg-primary" />
            </div>
            <Button type="button" variant="ghost" size="sm">
              重置中心
            </Button>
          </div>
        </div>
      </div>
    </SettingsSection>

    <SettingsSection title="系统时间">
      <div className="flex items-center gap-4">
        <span className="font-mono text-mono-md tabular-nums text-foreground">{systemTime}</span>
        <Button type="button" variant="secondary" size="sm">
          同步网络时间
        </Button>
      </div>
    </SettingsSection>
  </div>
);
