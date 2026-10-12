/**
 * Gives the shared `@openreel/ui` controls their text in the current UI
 * language (the package itself has no i18n dependency; see `ui-strings.tsx`).
 */
import type { JSX, ReactNode } from "react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { UiStringsProvider, type UiStrings } from "@openreel/ui";

export function TranslatedUiStrings({ children }: { children: ReactNode }): JSX.Element {
  const { t } = useTranslation();
  const strings = useMemo<UiStrings>(
    () => ({
      sliderValue: (label) => (label ? t("tools.uiControls.sliderValue", { label }) : t("tools.uiControls.sliderValueGeneric")),
      editSliderValue: (label) => (label ? t("tools.uiControls.editValue", { label }) : t("tools.uiControls.editValueGeneric")),
      clickToEdit: t("tools.uiControls.clickToEdit"),
      clickToEditOrReset: t("tools.uiControls.clickToEditOrReset"),
      closeDialog: t("tools.uiControls.closeDialog"),
    }),
    [t],
  );
  return <UiStringsProvider value={strings}>{children}</UiStringsProvider>;
}
