import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, ImagePlus, X } from "@/icons/lucide-compat";
import { MAX_REFERENCE_IMAGES, type ImageInput } from "../../services/ltx/types";
import { pickImages, readLocalBytes } from "./desktop-files";
import { useLocalFileUrl } from "./local-media";

function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
}

function Thumb({
  image,
  index,
  count,
  onRemove,
  onMove,
}: {
  image: ImageInput;
  index: number;
  count: number;
  onRemove: () => void;
  onMove: (to: number) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const { url } = useLocalFileUrl(image.path, readLocalBytes);
  return (
    <div className="group relative aspect-square overflow-hidden rounded-[10px] border border-border bg-[var(--stage-bg)]" title={image.name}>
      {url ? <img src={url} alt={image.name} className="h-full w-full object-cover" /> : null}
      <span className="absolute left-1.5 top-1.5 rounded-md bg-black/65 px-1.5 text-[10.5px] font-bold text-white">{index + 1}</span>
      <button
        type="button"
        onClick={onRemove}
        className="absolute right-1 top-1 rounded-full bg-black/65 p-1 text-white opacity-0 transition-opacity hover:bg-black/85 group-hover:opacity-100"
        aria-label={t("create.form.removeReference", { index: index + 1 })}
      >
        <X size={11} aria-hidden />
      </button>
      <div className="absolute inset-x-1 bottom-1 flex justify-between opacity-0 transition-opacity group-hover:opacity-100">
        <button
          type="button"
          disabled={index === 0}
          onClick={() => onMove(index - 1)}
          className="rounded-full bg-black/65 p-0.5 text-white disabled:invisible"
          aria-label={t("create.director.moveUp")}
        >
          <ChevronLeft size={13} aria-hidden />
        </button>
        <button
          type="button"
          disabled={index === count - 1}
          onClick={() => onMove(index + 1)}
          className="rounded-full bg-black/65 p-0.5 text-white disabled:invisible"
          aria-label={t("create.director.moveDown")}
        >
          <ChevronRight size={13} aria-hidden />
        </button>
      </div>
    </div>
  );
}

/** Up to 12 reference images (characters, props, scenes) composed into one sheet for LTX. */
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
      <div className="grid grid-cols-4 gap-2">
        {images.map((image, index) => (
          <Thumb
            key={image.path}
            image={image}
            index={index}
            count={images.length}
            onRemove={() => onChange(images.filter((_, position) => position !== index))}
            onMove={(to) => onChange(moveItem(images, index, to))}
          />
        ))}
        {room > 0 ? (
          <button type="button" className="fc-drop !aspect-square" onClick={() => void add()} aria-label={t("create.form.addReferences")}>
            <ImagePlus size={18} aria-hidden />
            <span className="text-[11px] font-semibold">{t("create.form.add")}</span>
          </button>
        ) : null}
      </div>
      <p className="text-[11.5px] leading-relaxed text-fg-muted">{t("create.form.referencesTip")}</p>
    </section>
  );
}
