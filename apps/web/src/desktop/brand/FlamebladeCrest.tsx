import type { JSX } from "react";
import crestUrl from "./flameblade-crest.png";

/** The Flameblade Studio crest (flame, sword and gold ring), used as the app mark. */
export function FlamebladeCrest({ size, className }: { size: number; className?: string }): JSX.Element {
  return (
    <img
      src={crestUrl}
      width={Math.round(size * (214 / 256))}
      height={size}
      alt=""
      aria-hidden
      draggable={false}
      className={className}
      style={{ objectFit: "contain" }}
    />
  );
}
