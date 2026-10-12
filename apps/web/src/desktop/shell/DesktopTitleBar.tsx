import type { JSX } from "react";
import type React from "react";
import { WindowControls } from "./WindowControls";
import { useTranslation } from "react-i18next";
import { FlamebladeCrest } from "../brand/FlamebladeCrest";

export function DesktopTitleBar({ platform, children }: { platform: string; children?: React.ReactNode }): JSX.Element {
  const isMac = platform === "darwin";
  const { t } = useTranslation();
  return (
    <header
      className="flex h-10 shrink-0 items-center justify-between border-b border-border bg-bg-1 text-fg"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      <div className="flex items-center gap-2" style={{ paddingLeft: isMac ? 76 : 12 }}>
        <FlamebladeCrest size={20} />
        <span className="text-[13px] font-bold tracking-wider text-fg">{t("create.brand.name")}</span>
        {t("create.brand.name") === "Flameblade Cut" ? null : (
          <span className="text-[11px] font-medium tracking-wide text-fg-muted">Flameblade Cut</span>
        )}
      </div>
      <div className="flex items-center" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
        {children}
      </div>
      <WindowControls platform={platform} />
    </header>
  );
}
