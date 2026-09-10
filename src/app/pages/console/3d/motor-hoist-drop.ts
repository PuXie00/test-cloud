export const MOTOR_HOIST_DRAG_TYPE = "application/x-console-motor-id";

type MotorHoistDragPayload = {
  motorIds: string[];
};

export const isMotorHoistDrag = (dataTransfer: DataTransfer): boolean =>
  dataTransfer.types.includes(MOTOR_HOIST_DRAG_TYPE);

export const writeMotorHoistDrag = (
  dataTransfer: DataTransfer,
  motorIds: readonly string[],
): void => {
  const ids = motorIds.map((id) => id.trim()).filter(Boolean);
  const payload: MotorHoistDragPayload = { motorIds: ids };
  dataTransfer.setData(MOTOR_HOIST_DRAG_TYPE, JSON.stringify(payload));
  dataTransfer.effectAllowed = "link";
};

export const readMotorHoistDrag = (dataTransfer: DataTransfer): string[] | null => {
  const raw = dataTransfer.getData(MOTOR_HOIST_DRAG_TYPE).trim();
  if (!raw) return null;

  if (raw.startsWith("{")) {
    try {
      const parsed = JSON.parse(raw) as Partial<MotorHoistDragPayload>;
      const ids = Array.isArray(parsed.motorIds)
        ? parsed.motorIds.map((id) => String(id).trim()).filter(Boolean)
        : [];
      return ids.length > 0 ? ids : null;
    } catch {
      return null;
    }
  }

  return [raw];
};
