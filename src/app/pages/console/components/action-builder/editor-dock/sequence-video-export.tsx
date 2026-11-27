import { useRef, useState } from "react";
import { Film } from "lucide-react";
import { Button } from "@/app/components/ui/button";
import { VideoExportDialog } from "../../../3d/overlays/VideoExportDialog";
import type { useSequenceVideoCapture } from "../timeline/use-sequence-video-capture";

type Props = {
  name: string;
  canExport: boolean;
  captureState: ReturnType<typeof useSequenceVideoCapture>;
};

export const SequenceVideoExport = ({ name, canExport, captureState }: Props) => {
  const { capture, cancel, progress } = captureState;
  const [open, setOpen] = useState(false);
  const [clip, setClip] = useState<Blob | null>(null);
  const [error, setError] = useState("");
  const generation = useRef(0);

  const generate = async () => {
    const current = ++generation.current;
    setClip(null);
    setError("");
    setOpen(true);
    try {
      const video = await capture();
      if (generation.current === current) setClip(video);
    } catch (reason) {
      if (generation.current !== current) return;
      if (reason instanceof Error && reason.name === "AbortError") {
        setOpen(false);
        return;
      }
      setError(reason instanceof Error ? reason.message : "无法生成预览视频");
    }
  };

  const close = () => {
    generation.current++;
    cancel();
    setOpen(false);
    setClip(null);
  };

  return (
    <>
      <button
        type="button"
        className="inline-flex h-7 shrink-0 items-center gap-1 rounded-sm px-2 text-body-sm hover:bg-accent disabled:opacity-40"
        disabled={!canExport}
        onClick={() => void generate()}
      >
        <Film className="size-3.5" aria-hidden />
        导出视频
      </button>
      <VideoExportDialog open={open} onOpenChange={next => { if (!next) close(); }}
        clip={clip} title="动作序列预览视频">
        {error ? (
          <>
            <p role="alert" className="text-body-sm text-danger">{error}</p>
            <Button className="justify-self-end" onClick={() => void generate()}>重试</Button>
          </>
        ) : (
          <>
            <div className="flex justify-between gap-2 text-body-sm">
              <span>正在生成「{name}」的预览视频</span>
              <span className="tabular-nums">{Math.round(progress * 100)}%</span>
            </div>
            <progress aria-label="视频生成进度" value={progress} max={1}
              className="h-2 w-full accent-primary" />
            <Button className="justify-self-end" variant="secondary" onClick={close}>取消生成</Button>
          </>
        )}
      </VideoExportDialog>
    </>
  );
};
