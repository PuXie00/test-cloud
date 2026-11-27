import { useEffect, useRef, useState } from "react";
import { Film, Square, Video } from "lucide-react";
import { toast } from "sonner";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/app/components/ui/dropdown-menu";
import { ViewMenu, MENU_ITEM_CLASS, type ViewMenuProps } from "./ViewMenu";
import { VideoExportDialog } from "./VideoExportDialog";
import type { RecordingStatePayload } from "@/app/viz3d";
import { useViz3DContext } from "../Viz3DProvider";

const toolbarButton = "inline-flex h-7 shrink-0 items-center gap-1 rounded-sm px-1 text-body-sm hover:bg-accent disabled:opacity-50 [&_svg]:size-4";
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

export const ViewportRecordingControls = ({ onPointerGuard, showMotionPaths }: ViewMenuProps) => {
  const engine = useViz3DContext();
  const [recording, setRecording] = useState(() => engine.isRecording());
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [clip, setClip] = useState<Blob | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onRecording = (event: RecordingStatePayload) => {
      setRecording(event.state === "recording");
      if (event.state === "error" || event.state === "unsupported") {
        toast.error(event.message ?? "无法录制 3D 画面", { id: "viewport-recording" });
      }
    };
    engine.events.on("recordingState", onRecording);
    return () => {
      engine.events.off("recordingState", onRecording);
      if (engine.isRecording()) engine.cancelRecording();
    };
  }, [engine]);

  const startRecording = () => {
    if (busyRef.current || recording) return;
    try {
      engine.startRecording();
    } catch (reason) {
      toast.error(errorText(reason), { id: "viewport-recording" });
    }
  };

  const stopRecording = async () => {
    if (busyRef.current || !recording) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const blob = await engine.stopRecording();
      setClip(blob);
      setOpen(true);
    } catch (reason) {
      toast.error(errorText(reason), { id: "viewport-recording" });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <>
      <ViewMenu onPointerGuard={onPointerGuard} showMotionPaths={showMotionPaths}>
        <DropdownMenuSeparator />
        <DropdownMenuItem className={MENU_ITEM_CLASS} disabled={recording || busy} onSelect={startRecording}>
          <Video aria-hidden />开始录制
        </DropdownMenuItem>
        <DropdownMenuItem className={MENU_ITEM_CLASS} disabled={recording || busy}
          onSelect={() => setOpen(true)}>
          <Film aria-hidden />查看导出
        </DropdownMenuItem>
      </ViewMenu>
      {recording && (
        <button type="button" className={toolbarButton} aria-label="停止录制" title="停止录制"
          disabled={busy} onClick={() => void stopRecording()}>
          <Square aria-hidden className="fill-current text-danger" />
          <span className="hidden @min-[32rem]:inline">停止录制</span>
        </button>
      )}
      <VideoExportDialog open={open} onOpenChange={setOpen} clip={clip} allowOpenFile />
    </>
  );
};
