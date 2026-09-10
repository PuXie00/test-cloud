import { useProgram } from "../../../hooks/use-program";

type DetailRelatedProgramProps = { objectName: string };

export const DetailRelatedProgram = ({ objectName }: DetailRelatedProgramProps) => {
  const { program } = useProgram();
  // 简单：列出所有章节标题 + 第一项（mock 关联）
  return (
    <section className="space-y-1 border-t border-border px-3 py-3">
      <div className="text-label-caps text-muted-foreground">关联节目项</div>
      <p className="text-body-sm text-muted-foreground">显示 {objectName} 在以下章节中可能涉及</p>
      <ul className="space-y-1 text-body-sm text-foreground">
        {program.chapters.map((chapter) => (
          <li key={chapter.id}>· {chapter.name}（{chapter.items.length} 项）</li>
        ))}
      </ul>
    </section>
  );
};
