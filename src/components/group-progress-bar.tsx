import type { GroupProductProgress } from "../lib/product-state";

function segmentWidth(count: number, total: number) {
  if (total === 0 || count === 0) {
    return 0;
  }

  return (count / total) * 100;
}

function LegendItem({
  colorClassName,
  count,
  label,
}: {
  colorClassName: string;
  count: number;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden
        className={`h-2 w-2 shrink-0 rounded-full ${colorClassName}`}
      />
      <span>
        {label}{" "}
        <span className="tabular-nums text-slate-700">{count.toLocaleString()}</span>
      </span>
    </span>
  );
}

export function GroupProgressBar({ progress }: { progress: GroupProductProgress }) {
  const { captured, pending, published, total } = progress;
  const pendingWidth = segmentWidth(pending, total);
  const capturedWidth = segmentWidth(captured, total);
  const publishedWidth = segmentWidth(published, total);

  return (
    <div className="space-y-2">
      <div
        aria-label={`${pending} pending, ${captured} captured, ${published} published`}
        className="flex h-2 overflow-hidden rounded-full bg-slate-200"
        role="img"
      >
        {total === 0 ? null : (
          <>
            {pendingWidth > 0 ? (
              <div
                className="h-full bg-slate-300 transition-[width] duration-300"
                style={{ width: `${pendingWidth}%` }}
              />
            ) : null}
            {capturedWidth > 0 ? (
              <div
                className="h-full bg-amber-400 transition-[width] duration-300"
                style={{ width: `${capturedWidth}%` }}
              />
            ) : null}
            {publishedWidth > 0 ? (
              <div
                className="h-full bg-green-500 transition-[width] duration-300"
                style={{ width: `${publishedWidth}%` }}
              />
            ) : null}
          </>
        )}
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
        <LegendItem colorClassName="bg-slate-300" count={pending} label="Pending" />
        <LegendItem colorClassName="bg-amber-400" count={captured} label="Captured" />
        <LegendItem colorClassName="bg-green-500" count={published} label="Published" />
      </div>
    </div>
  );
}
