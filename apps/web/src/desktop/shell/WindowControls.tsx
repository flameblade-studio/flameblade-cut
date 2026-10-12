import type { JSX } from "react";
import type React from "react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

/** 10x10 caption glyphs drawn like Windows 11's own title bar (1px strokes, pixel-aligned). */
function CaptionGlyph({ kind }: { kind: "minimize" | "maximize" | "restore" | "close" }): JSX.Element {
  const common = { width: 10, height: 10, viewBox: "0 0 10 10", fill: "none", stroke: "currentColor", strokeWidth: 1, "aria-hidden": true } as const;
  switch (kind) {
    case "minimize":
      return (
        <svg {...common}>
          <path d="M0 5.5h10" />
        </svg>
      );
    case "maximize":
      return (
        <svg {...common}>
          <rect x="0.5" y="0.5" width="9" height="9" rx="1" />
        </svg>
      );
    case "restore":
      return (
        <svg {...common}>
          <rect x="0.5" y="2.5" width="7" height="7" rx="1" />
          <path d="M2.5 2.5V1.5a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-1" />
        </svg>
      );
    case "close":
      return (
        <svg {...common}>
          <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" />
        </svg>
      );
  }
}

const BUTTON_CLASS =
  "grid h-10 w-[46px] place-items-center text-fg-2 transition-colors duration-100 hover:bg-hover hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--accent)]";

export function WindowControls({ platform }: { platform: string }): JSX.Element | null {
  const { t } = useTranslation();
  const api = typeof window !== "undefined" ? window.openreel?.win : undefined;
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!api || platform === "darwin") return;
    let alive = true;
    void api.isMaximized().then((value) => {
      if (alive) setMaximized(value);
    });
    const unsubscribe = api.onMaximizedChange?.((value) => setMaximized(value));
    return () => {
      alive = false;
      unsubscribe?.();
    };
  }, [api, platform]);

  if (platform === "darwin" || !api) return null;
  const sizeLabel = maximized ? t("desktop.window.restore") : t("desktop.window.maximize");
  return (
    <div className="flex items-center self-stretch" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
      <button type="button" className={BUTTON_CLASS} aria-label={t("desktop.window.minimize")} title={t("desktop.window.minimize")} onClick={() => void api.minimize()}>
        <CaptionGlyph kind="minimize" />
      </button>
      <button type="button" className={BUTTON_CLASS} aria-label={sizeLabel} title={sizeLabel} onClick={() => void api.toggleMaximize()}>
        <CaptionGlyph kind={maximized ? "restore" : "maximize"} />
      </button>
      <button
        type="button"
        className={`${BUTTON_CLASS} hover:!bg-[#c42b1c] hover:!text-white`}
        aria-label={t("desktop.window.close")}
        title={t("desktop.window.close")}
        onClick={() => void api.close()}
      >
        <CaptionGlyph kind="close" />
      </button>
    </div>
  );
}
