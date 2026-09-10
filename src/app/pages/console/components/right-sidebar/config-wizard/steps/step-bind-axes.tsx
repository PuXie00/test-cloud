import { Box } from "lucide-react";
import { cn } from "@/app/components/ui/utils";
import { CONTROL_TYPE_DEFINITION_BY_ID } from "../config-descriptors";
import {
  CONTROL_TYPE_RULES,
  controlTypeHasNoDriveAxes,
} from "@/app/project/configuration-rules";
import { countBoundAxesOnObject } from "@/app/pages/console/hooks/binding-utils";
import { useProjectStore } from "@/app/pages/console/hooks/use-project-store";
import { ObjectAxesEditor } from "../object-axes-editor";

export const StepBindAxes = () => {
  const { objects, motors, getBindingSummary } = useProjectStore();
  const { bound, total } = getBindingSummary();

  return (
    <div className="space-y-5">
      <p className="text-heading-md text-foreground">将驱动单元绑定到各受控物体的驱动轴</p>

      {objects.length === 0 ? (
        <p className="py-8 text-center text-body-sm text-muted-foreground">请先添加受控物体</p>
      ) : (
        objects.map((object) => {
          const definition = CONTROL_TYPE_DEFINITION_BY_ID[object.controlType];
          const minimum = CONTROL_TYPE_RULES[object.controlType].minimumDriveAxes;
          const boundCount = countBoundAxesOnObject(object, motors);

          return (
            <div key={object.id} className="space-y-3 rounded-md bg-muted p-4">
              <div className="flex flex-wrap items-center gap-2 text-body-sm">
                <Box className="h-4 w-4 text-primary" aria-hidden />
                <span className="font-medium text-foreground">{object.name}</span>
                <span className="text-muted-foreground">
                  {definition.label} · 至少 {minimum} 吊点 · 当前 {object.axes.length} 吊点 · 已绑{" "}
                  {boundCount}
                </span>
              </div>

              {!controlTypeHasNoDriveAxes(object.controlType) ? (
                <ObjectAxesEditor
                  objectId={object.id}
                  controlType={object.controlType}
                  axes={object.axes}
                />
              ) : null}
            </div>
          );
        })
      )}

      <p className={cn("text-body-sm", bound < total ? "text-warning" : "text-show")}>
        绑定概览：{bound}/{total} 轴已绑定
        {bound < total && ` · ${total - bound} 轴未绑定`}
      </p>
    </div>
  );
};
