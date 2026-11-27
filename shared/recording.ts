export const RECORDING_CHANNELS = {
  saveVideo: 'recording:save-video',
  revealVideo: 'recording:reveal-video',
} as const

export interface RecordingAPI {
  /** 保存成功后返回路径；取消文件对话框返回 null。 */
  saveVideo(bytes: ArrayBuffer): Promise<string | null>
  revealVideo(filePath: string): Promise<void>
}
