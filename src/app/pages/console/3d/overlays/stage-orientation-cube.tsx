import type { KeyboardEvent, ReactNode } from "react";
import type { CellOrientation, Vec3, ViewPreset } from "@/app/viz3d";

type CubeView = Exclude<ViewPreset, "persp" | "iso">;
type Face = {
  preset: CubeView;
  label: string;
  normal: Vec3;
  right: Vec3;
  down: Vec3;
};

const X = { x: 1, y: 0, z: 0 };
const Y = { x: 0, y: 1, z: 0 };
const Z = { x: 0, y: 0, z: 1 };
const neg = (v: Vec3): Vec3 => ({ x: -v.x, y: -v.y, z: -v.z });
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

// 观众从 +Z 看向舞台时，+X 在画面左侧，即演员的台右。
const FACES: Face[] = [
  { preset: "front", label: "台口", normal: Z, right: neg(X), down: neg(Y) },
  { preset: "back", label: "台后", normal: neg(Z), right: X, down: neg(Y) },
  { preset: "side", label: "台右", normal: X, right: Z, down: neg(Y) },
  { preset: "left", label: "台左", normal: neg(X), right: neg(Z), down: neg(Y) },
  { preset: "top", label: "顶", normal: Y, right: neg(X), down: Z },
  { preset: "bottom", label: "底", normal: neg(Y), right: neg(X), down: neg(Z) },
];

const HALF_FACE = 24;
const stopPropagation = (event: { stopPropagation(): void }) => event.stopPropagation();

const StageViewButton = ({ face, onSelect, children, transform }: {
  face: Face;
  onSelect: (preset: CubeView) => void;
  children: ReactNode;
  transform: string;
}) => {
  const select = () => onSelect(face.preset);
  const handleKey = (event: KeyboardEvent<SVGGElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.stopPropagation();
    event.preventDefault();
    if (!event.repeat) select();
  };
  return (
    <g
      role="button"
      aria-label={`从${face.label}看`}
      tabIndex={0}
      transform={transform}
      onClick={(event) => {
        event.stopPropagation();
        select();
      }}
      onKeyDown={handleKey}
      className="group pointer-events-auto cursor-pointer outline-none"
    >
      <title>{`从${face.label}看`}</title>
      {children}
    </g>
  );
};

type StageOrientationCubeProps = {
  orientation: CellOrientation;
  onSelect: (preset: CubeView) => void;
  className?: string;
};

export const StageOrientationCube = ({ orientation, onSelect, className }: StageOrientationCubeProps) => {
  const { right, up, towardCamera } = orientation;
  const headOn = FACES.find((face) => dot(face.normal, towardCamera) > 0.99995);
  return (
    <svg
      role="group"
      aria-label="舞台方位立方体"
      viewBox="-44 -44 88 88"
      width="80"
      height="80"
      className={`pointer-events-none block select-none touch-none ${className ?? ""}`}
      onPointerDown={stopPropagation}
      onPointerUp={stopPropagation}
      onDoubleClick={stopPropagation}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {FACES.map((face) => {
        const facing = dot(face.normal, towardCamera);
        const x = dot(face.normal, right);
        const y = -dot(face.normal, up);
        // 正对单面时，相邻面在屏幕上只有一条线，用箭头保留切面入口。
        if (headOn && dot(face.normal, headOn.normal) === 0) {
          const angle = Math.atan2(y, x) * 180 / Math.PI;
          return (
            <StageViewButton
              key={face.preset}
              face={face}
              onSelect={onSelect}
              transform={`translate(${35 * x} ${35 * y}) rotate(${angle})`}
            >
              <rect x="-8" y="-10" width="16" height="20" fill="transparent" />
              <path
                d="m-3 -4 4 4 -4 4"
                fill="none"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="stroke-muted-foreground group-hover:stroke-primary group-focus-visible:stroke-primary"
              />
            </StageViewButton>
          );
        }
        if (facing < 0.001) return null;

        // 每个面的局部坐标直接投影到相机的屏幕基底，标签和命中面同步旋转。
        const matrix = [
          dot(face.right, right), -dot(face.right, up),
          dot(face.down, right), -dot(face.down, up),
          HALF_FACE * x, HALF_FACE * y,
        ];
        const front = face.preset === "front";
        const surface = face.preset === "top" ? "fill-[#627178]" : "fill-[#45535b]";
        return (
          <StageViewButton key={face.preset} face={face} onSelect={onSelect} transform={`matrix(${matrix.join(" ")})`}>
            <rect
              x={-HALF_FACE} y={-HALF_FACE} width={2 * HALF_FACE} height={2 * HALF_FACE}
              strokeWidth="1.4" vectorEffect="non-scaling-stroke"
              className={`${front ? "fill-primary" : surface} stroke-background group-hover:brightness-125 group-focus-visible:stroke-foreground`}
            />
            <text
              y="1" textAnchor="middle" dominantBaseline="central" fontSize="15" fontWeight="600"
              className={`pointer-events-none ${front ? "fill-primary-foreground" : "fill-white"}`}
            >
              {face.label}
            </text>
          </StageViewButton>
        );
      })}
    </svg>
  );
};
