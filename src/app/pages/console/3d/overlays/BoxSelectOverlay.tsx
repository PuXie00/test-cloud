import type { ScreenRect } from "@/app/viz3d";

type BoxSelectOverlayProps = {
  rect: ScreenRect | null;
};

export const BoxSelectOverlay = ({ rect }: BoxSelectOverlayProps) => {
  if (!rect || rect.width < 1 || rect.height < 1) {
    return null;
  }

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-[5]"
    >
      <div
        className="absolute border border-primary bg-primary/10"
        style={{
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        }}
      />
    </div>
  );
};
