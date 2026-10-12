import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { ImagePlus, X } from "@/icons/lucide-compat";
import type { ImageInput } from "../../services/ltx/types";
import { readLocalBytes } from "./desktop-files";
import { useLocalFileUrl } from "./local-media";

interface ImageSlotProps {
  label: string;
  image: ImageInput | null;
  onPick: () => void;
  onClear: () => void;
}

/** A clickable image well: empty state invites an upload, filled state previews the image. */
export function ImageSlot({ label, image, onPick, onClear }: ImageSlotProps): JSX.Element {
  const { t } = useTranslation();
  const { url } = useLocalFileUrl(image?.path ?? null, readLocalBytes);
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      <button type="button" className="fc-drop" onClick={onPick} aria-label={`${label} ${t("create.form.upload")}`}>
        {url ? <img src={url} alt="" /> : null}
        {url ? (
          <span className="absolute bottom-2 left-2 rounded-md bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-white backdrop-blur">
            {t("create.form.replace")}
          </span>
        ) : (
          <>
            <ImagePlus size={22} aria-hidden />
            <span className="text-[12px] font-semibold">{t("create.form.upload")}</span>
          </>
        )}
      </button>
      <div className="flex items-center justify-between px-0.5">
        <span className="truncate text-[12px] text-fg-3" title={image?.name}>
          {label}
        </span>
        {image ? (
          <button
            type="button"
            onClick={onClear}
            className="rounded p-0.5 text-fg-muted transition-colors hover:text-fg"
            aria-label={t("create.actions.delete")}
          >
            <X size={13} aria-hidden />
          </button>
        ) : null}
      </div>
    </div>
  );
}
