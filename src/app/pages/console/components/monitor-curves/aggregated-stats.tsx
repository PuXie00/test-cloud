import { CurveChart } from "./curve-chart";
import { useControlledObjects } from "../../hooks/use-controlled-objects";

export const AggregatedStats = () => {
  const { snapshots } = useControlledObjects();
  const onlineCount = snapshots.filter((entry) => entry.descriptor.status !== "offline").length;
  const alarmCount = snapshots.filter(
    (entry) => entry.descriptor.status === "alarm" || entry.descriptor.status === "warning"
  ).length;
  const totalTorqueHistory = snapshots[0]?.history ?? [];

  return (
    <div className="space-y-3 p-3">
      <CurveChart
        label={`整体连接率 ${onlineCount}/${snapshots.length}`}
        unit=""
        value={onlineCount}
        history={Array.from({ length: 12 }, () => onlineCount)}
      />
      <CurveChart
        label="当前活跃报警"
        unit="条"
        value={alarmCount}
        history={Array.from({ length: 12 }, () => alarmCount)}
        warning={alarmCount > 0}
      />
      <CurveChart
        label="参考扭矩"
        unit=""
        value={totalTorqueHistory[totalTorqueHistory.length - 1] ?? 0}
        history={totalTorqueHistory}
      />
    </div>
  );
};
