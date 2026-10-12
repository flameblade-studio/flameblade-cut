/**
 * Social-platform safe-area guide (安全框) for the preview: a toolbar
 * picker and a pointer-transparent overlay. Geometry lives in
 * `services/captions/safe-area.ts`; the selection in `safe-area-store.ts`.
 */
import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Smartphone } from "@/icons/lucide-compat";
import {
  SAFE_AREA_PLATFORM_IDS,
  SAFE_AREA_PRESETS,
  type NormalizedRect,
} from "../../../services/captions/safe-area";
import { useSafeAreaGuideStore } from "../../../services/captions/safe-area-store";

function rectStyle(rect: NormalizedRect): React.CSSProperties {
  return {
    left: `${rect.left * 100}%`,
    top: `${rect.top * 100}%`,
    width: `${(rect.right - rect.left) * 100}%`,
    height: `${(rect.bottom - rect.top) * 100}%`,
  };
}

/** Overlay drawn inside the preview frame. Renders nothing when no guide is chosen. */
export const SocialSafeAreaOverlay: React.FC = () => {
  const { t } = useTranslation();
  const platform = useSafeAreaGuideStore((state) => state.platform);
  if (!platform) return null;
  const preset = SAFE_AREA_PRESETS[platform];
  return (
    <div
      aria-label={t("captions.safeArea.overlayLabel", { platform: preset.label })}
      className="pointer-events-none absolute inset-0 z-20 overflow-hidden rounded-[10px]"
    >
      {preset.covered.map((region, index) => (
        <span
          key={`${region.kind}-${index}`}
          className={`absolute ${region.kind === "margin" ? "bg-black/10" : "bg-black/25"}`}
          style={rectStyle(region)}
        />
      ))}
      <span
        className="absolute border border-white/70 shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
        style={rectStyle(preset.safe)}
      />
      <span
        className="absolute rounded-sm bg-black/55 px-1.5 py-0.5 text-[9px] font-semibold tracking-wide text-white/85"
        style={{ left: `${preset.safe.left * 100}%`, top: `${preset.safe.top * 100}%` }}
      >
        {t("captions.safeArea.badge", { platform: preset.label })}
      </span>
    </div>
  );
};

/** Toolbar button with a small platform menu. */
export const SocialSafeAreaToolbarButton: React.FC = () => {
  const { t } = useTranslation();
  const platform = useSafeAreaGuideStore((state) => state.platform);
  const setPlatform = useSafeAreaGuideStore((state) => state.setPlatform);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const choose = (value: typeof platform) => {
    setPlatform(value);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={t("captions.safeArea.toolbar")}
        title={t("captions.safeArea.toolbar")}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-pressed={platform !== null}
        onClick={() => setOpen((value) => !value)}
        className={`w-[34px] h-[34px] grid place-items-center rounded-[7px] transition-colors ${
          platform ? "bg-accent-soft text-accent" : "bg-bg-2 text-fg-2 hover:text-fg hover:bg-bg-3"
        }`}
      >
        <Smartphone size={16} aria-hidden />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute bottom-full right-0 z-50 mb-2 w-44 rounded-lg border border-border bg-bg-1 p-1 shadow-xl"
        >
          <button
            type="button"
            role="menuitemradio"
            aria-checked={platform === null}
            onClick={() => choose(null)}
            className="w-full rounded-md px-2 py-1.5 text-left text-[11px] text-fg-2 hover:bg-bg-3"
          >
            {t("captions.safeArea.off")}
          </button>
          {SAFE_AREA_PLATFORM_IDS.map((id) => (
            <button
              key={id}
              type="button"
              role="menuitemradio"
              aria-checked={platform === id}
              onClick={() => choose(id)}
              className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[11px] hover:bg-bg-3 ${
                platform === id ? "text-accent" : "text-fg"
              }`}
            >
              <span>{SAFE_AREA_PRESETS[id].label}</span>
              <span className="text-[9px] text-fg-3">
                {SAFE_AREA_PRESETS[id].orientation === "vertical" ? "9:16" : "16:9"}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
