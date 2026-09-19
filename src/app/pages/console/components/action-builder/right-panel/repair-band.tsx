export const RepairBand = ({ items }: { items: string[] }) => {
  if (items.length === 0) return null;
  return (
    <section aria-label="待修复内容" className="mb-3 rounded-md bg-warning-surface px-3 py-3">
      <p className="mb-2 text-label-caps text-warning">待修复内容</p>
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item} className="text-body-sm text-warning">
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
};
