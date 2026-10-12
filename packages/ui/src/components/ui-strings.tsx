import * as React from "react"

/**
 * Built-in text of the shared UI controls (tooltips, accessible labels).
 * The package has no i18n dependency: English is the default and an app
 * provides its own language with `UiStringsProvider`.
 */
export interface UiStrings {
  /** Accessible label of a slider's number field, e.g. "Opacity value". */
  sliderValue(label: string | undefined): string
  /** Accessible label of the button that turns the number into an input. */
  editSliderValue(label: string | undefined): string
  clickToEdit: string
  clickToEditOrReset: string
  /** Accessible label of a dialog's close button. */
  closeDialog: string
}

export const DEFAULT_UI_STRINGS: UiStrings = {
  sliderValue: (label) => (label ? `${label} value` : "Slider value"),
  editSliderValue: (label) => (label ? `Edit ${label} value` : "Edit slider value"),
  clickToEdit: "Click to edit",
  clickToEditOrReset: "Click to edit, double-click to reset",
  closeDialog: "Close dialog",
}

const UiStringsContext = React.createContext<UiStrings>(DEFAULT_UI_STRINGS)

export const UiStringsProvider = UiStringsContext.Provider

export function useUiStrings(): UiStrings {
  return React.useContext(UiStringsContext)
}
