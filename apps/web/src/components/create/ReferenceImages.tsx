import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp, ImagePlus, X } from "@/icons/lucide-compat";
import { MAX_REFERENCE_IMAGES, type ImageInput } from "../../services/ltx/types";
import { pickImages, readLocalBytes } from "./desktop-files";
import { useLocalFileUrl } from "./local-media";

function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
}

/** One reference: thumbnail, "what is this" description, reorder and remove. */
function ReferenceRow({
  image,
  index,
  count,
  onChange,
  onRemove,
  onMove,
}: {
  image: ImageInput;
  index: number;
  count: number;
  onChange: (image: ImageInput) => void;
  onRemove: () => void;
  onMove: (to: number) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const { url } = useLocalFileUrl(image.path, readLocalBytes);
  const iconButton = "rounded-md p-1 text-fg-3 transition-colors hover:bg-[var(--hover)] hover:text-fg disabled:invisible";
  return (
    <li className="flex items-start gap-2.5 rounded-[10px] border border-border bg-bg-1 p-2">
      <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md bg-[var(--stage-bg)]" title={image.name}>
        {url ? <img src={url} alt={image.name} className="h-full w-full object-cover" /> : null}
        <span className="absolute left-1 top-1 rounded bg-black/65 px-1 text-[10px] font-bold text-white">{index + 1}</span>
      </div>
      <textarea
        className="fc-input min-h-[56px] flex-1 resize-none !px-2.5 !py-1.5 !text-[12.5px] !leading-snug"
        rows={2}
        value={image.description ?? ""}
        placeholder={t("create.form.referenceDescribe")}
        aria-label={t("create.form.referenceDescribeLabel", { index: index + 1 })}
        onChange={(event) => onChange({ ...image, description: event.target.value })}
      />
      <div className="flex shrink-0 flex-col items-center">
        <button type="button" className={iconButton} onClick={onRemove} aria-label={t("create.form.removeReference", { index: index + 1 })}>
          <X size={13} aria-hidden />
        </button>
        <button type="button" className={iconButton} disabled={index === 0} onClick={() => onMove(index - 1)} aria-label={t("create.director.moveUp")}>
          <ChevronUp size={13} aria-hidden />
        </button>
        <button
          type="button"
          className={iconButton}
          disabled={index === count - 1}
          onClick={() => onMove(index + 1)}
          aria-label={t("create.director.moveDown")}
        >
          <ChevronDown size={13} aria-hidden />
        </button>
      </div>
    </li>
  );
}

/**
 * Up to 12 reference images (characters, props, scenes) composed into one
 * sheet for LTX, each with a short description that goes into the
 * Ingredients prompt next to its position on the sheet.
 */
export function ReferenceImages({ images, onChange }: { images: ImageInput[]; onChange: (images: ImageInput[]) => void }): JSX.Element {
  const { t } = useTranslation();
  const room = MAX_REFERENCE_IMAGES - images.length;

  const add = async (): Promise<void> => {
    const picked = await pickImages();
    const known = new Set(images.map((image) => image.path));
    onChange([...images, ...picked.filter((image) => !known.has(image.path))].slice(0, MAX_REFERENCE_IMAGES));
  };

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <h3 className="fc-label">{t("create.form.references")}</h3>
        <span className="text-[11.5px] font-semibold text-fg-3">
          {images.length}/{MAX_REFERENCE_IMAGES}
        </span>
      </div>
      <p className="text-[11.5px] leading-relaxed text-fg-muted">{t("create.form.referencesTip")}</p>
      {images.length > 0 ? (
        <ol className="flex flex-col gap-1.5">
          {images.map((image, index) => (
            <ReferenceRow
              key={image.path}
              image={image}
              index={index}
              count={images.length}
              onChange={(next) => onChange(images.map((current, position) => (position === index ? next : current)))}
              onRemove={() => onChange(images.filter((_, position) => position !== index))}
              onMove={(to) => onChange(moveItem(images, index, to))}
            />
          ))}
        </ol>
      ) : null}
      {room > 0 ? (
        <button type="button" className="fc-action justify-center" onClick={() => void add()}>
          <ImagePlus size={14} aria-hidden />
          {t("create.form.addReferences")}
        </button>
      ) : null}
    </section>
  );
}
