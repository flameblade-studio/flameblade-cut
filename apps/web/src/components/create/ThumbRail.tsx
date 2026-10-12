import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, Loader2 } from "@/icons/lucide-compat";
import type { GenerationRecord } from "../../services/ltx/types";
import { readLocalBytes } from "./desktop-files";
import { useLocalFileUrl } from "./local-media";

/** Thumbnails beyond this are not rendered, to bound memory (each loads its video). */
const MAX_THUMBS = 40;

function Thumb({ record }: { record: GenerationRecord }): JSX.Element {
  const path = record.status === "done" ? record.outputPath : null;
  const { url } = useLocalFileUrl(path, readLocalBytes);
  if (url) {
    return <video className="h-full w-full object-cover" src={`${url}#t=0.1`} muted preload="metadata" playsInline />;
  }
  if (record.status === "failed" || record.status === "canceled") {
    return <AlertCircle size={16} className="text-fg-muted" aria-hidden />;
  }
  return <Loader2 size={16} className="animate-spin text-[var(--gold)]" aria-hidden />;
}

export function ThumbRail({
  records,
  activeId,
  onSelect,
}: {
  records: readonly GenerationRecord[];
  activeId: string | null;
  onSelect: (id: string) => void;
}): JSX.Element {
  const { t } = useTranslation();
  return (
    <nav className="fc-scroll flex h-full flex-col gap-2.5 overflow-y-auto px-3 py-4" aria-label={t("create.feed.title")}>
      {records.slice(0, MAX_THUMBS).map((record) => (
        <button
          key={record.id}
          type="button"
          className="fc-thumb grid place-items-center"
          data-active={record.id === activeId}
          onClick={() => onSelect(record.id)}
          title={record.request.prompt}
          aria-label={t("create.feed.jumpTo")}
        >
          <Thumb record={record} />
        </button>
      ))}
    </nav>
  );
}
