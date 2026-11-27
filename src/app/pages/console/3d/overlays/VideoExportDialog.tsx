import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/app/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/app/components/ui/dialog";

const VideoPreview = ({ video }: { video: Blob }) => {
  const [url, setUrl] = useState<string>();
  const [failedUrl, setFailedUrl] = useState<string>();
  useEffect(() => {
    const next = URL.createObjectURL(video);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [video]);
  return (
    <>
      <video aria-label="视频回放" src={url} controls playsInline preload="metadata"
        className="max-h-[55vh] w-full rounded bg-black" onError={() => setFailedUrl(url)} />
      {url && failedUrl === url && (
        <p role="alert" className="text-body-sm text-danger">无法播放视频，请检查文件是否为完整的 WebM 视频。</p>
      )}
    </>
  );
};

type VideoExportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clip: Blob | null;
  title?: string;
  allowOpenFile?: boolean;
  /** 生成预览期间显示进度或失败后的重试操作。 */
  children?: ReactNode;
};

export const VideoExportDialog = ({
  open, onOpenChange, clip, title = "录制预览", allowOpenFile = false, children,
}: VideoExportDialogProps) => {
  const [filePath, setFilePath] = useState<string | null>(null);
  const [openedVideo, setOpenedVideo] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setFilePath(null);
    setOpenedVideo(null);
    setError("");
  }, [clip]);

  const save = async () => {
    if (!clip || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      if (!window.recordingAPI) throw new Error("导出视频需要在桌面控台中运行");
      const path = await window.recordingAPI.saveVideo(await clip.arrayBuffer());
      if (path) setFilePath(path);
    } catch (reason) {
      setError(`导出失败：${reason instanceof Error ? reason.message : String(reason)}`);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const reveal = async () => {
    try {
      if (filePath && window.recordingAPI) await window.recordingAPI.revealVideo(filePath);
    } catch (reason) {
      setError(`无法显示文件：${reason instanceof Error ? reason.message : String(reason)}`);
    }
  };

  const video = openedVideo ?? clip;
  const showGallery = allowOpenFile && (!clip || openedVideo);
  const description = openedVideo?.name ?? filePath ??
    (clip ? "WebM · 尚未导出" : allowOpenFile ? "选择已导出的 WebM 视频进行回放。" : undefined);

  return (
    <Dialog open={open} onOpenChange={next => {
      if (savingRef.current) return;
      setError("");
      onOpenChange(next);
    }}>
      <DialogContent className="gap-4 sm:max-w-3xl" onKeyDown={event => event.stopPropagation()}
        {...(!description ? { "aria-describedby": undefined } : {})}>
        <DialogHeader>
          <DialogTitle>{showGallery ? "查看导出" : title}</DialogTitle>
          {description && <DialogDescription className="break-all">{description}</DialogDescription>}
        </DialogHeader>
        {open && video && <VideoPreview video={video} />}
        {!video && children}
        {error && <p role="alert" className="text-body-sm text-danger">{error}</p>}
        {allowOpenFile && (
          <input ref={picker} type="file" accept=".webm,video/webm" className="hidden"
            aria-label="选择已导出的 WebM 视频" onChange={event => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              setOpenedVideo(file);
              setError("");
            }} />
        )}
        {(allowOpenFile || clip) && (
          <DialogFooter>
            {allowOpenFile && (
              <Button type="button" variant="secondary" disabled={saving} onClick={() => picker.current?.click()}>打开视频</Button>
            )}
            {openedVideo && clip && (
              <Button type="button" variant="secondary" onClick={() => { setOpenedVideo(null); setError(""); }}>
                返回本次录制
              </Button>
            )}
            {!openedVideo && clip && (filePath
              ? <Button type="button" onClick={() => void reveal()}>在文件夹中显示</Button>
              : <Button type="button" disabled={saving} onClick={() => void save()}>{saving ? "正在导出…" : "导出视频"}</Button>)}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
};
