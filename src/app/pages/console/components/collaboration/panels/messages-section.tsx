import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/components/ui/select";
import { cn } from "@/app/components/ui/utils";
import { CollabField } from "../collab-field";
import { CollabSection } from "../collab-section";
import { CollabSectionPanel } from "../collab-section-panel";
import { MESSAGE_RECIPIENT_OPTIONS, formatTimeNow } from "../collab-constants";
import { COLLAB_SURFACES } from "../collab-surfaces";
import type { CollabMessage, CollaborationState, MessageRecipient } from "../collab-types";

type MessagesSectionProps = {
  messages: CollabMessage[];
  onChange: (patch: Partial<CollaborationState>) => void;
};

export const MessagesSection = ({ messages, onChange }: MessagesSectionProps) => {
  const [messageTo, setMessageTo] = useState<MessageRecipient>("all");
  const [messageText, setMessageText] = useState("");

  const handleSendMessage = () => {
    const content = messageText.trim();
    if (!content) return;

    const recipient =
      MESSAGE_RECIPIENT_OPTIONS.find((item) => item.id === messageTo)?.label ?? "所有主机";

    onChange({
      messages: [
        {
          id: `msg-${Date.now()}`,
          from: "张工",
          to: recipient,
          content,
          time: formatTimeNow(),
        },
        ...messages,
      ].slice(0, 5),
    });
    setMessageText("");
    toast.success("消息已发送（演示）");
  };

  return (
    <CollabSection title="信息发送">
      <CollabSectionPanel className="flex flex-col gap-4 p-4">
        <div className="grid grid-cols-2 gap-x-4 gap-y-4">
          <CollabField label="收件方">
            <Select
              value={messageTo}
              onValueChange={(value) => setMessageTo(value as MessageRecipient)}
            >
              <SelectTrigger className="w-full bg-input-background" aria-label="收件方">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MESSAGE_RECIPIENT_OPTIONS.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CollabField>

          <CollabField label="消息内容">
            <div className="flex gap-2">
              <Input
                value={messageText}
                onChange={(event) => setMessageText(event.target.value)}
                placeholder="输入快捷消息…"
                className="min-w-0 flex-1 bg-input-background"
                aria-label="消息内容"
                onKeyDown={(event) => {
                  if (event.key === "Enter") handleSendMessage();
                }}
              />
              <Button type="button" size="sm" className="shrink-0" onClick={handleSendMessage}>
                发送
              </Button>
            </div>
          </CollabField>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-label-caps text-muted-foreground">收发记录</span>
          <div className="flex max-h-[140px] flex-col gap-2 overflow-y-auto custom-scrollbar">
            {messages.map((message, index) => (
              <div
                key={message.id}
                className={cn(
                  "rounded-md px-3 py-2",
                  index % 2 === 0 ? COLLAB_SURFACES.recessed : COLLAB_SURFACES.elevated,
                )}
              >
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-body-sm">
                  <span className="font-mono text-mono-sm tabular-nums text-muted-foreground">
                    {message.time}
                  </span>
                  <span className="text-foreground">{message.from}</span>
                  <span className="text-muted-foreground">→ {message.to}</span>
                </div>
                <p className="mt-0.5 text-body-sm text-foreground">{message.content}</p>
              </div>
            ))}
          </div>
        </div>
      </CollabSectionPanel>
    </CollabSection>
  );
};
