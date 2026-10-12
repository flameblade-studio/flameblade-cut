import React from "react";

interface CaptionToggleProps {
  label: string;
  checked: boolean;
  onChange(checked: boolean): void;
  disabled?: boolean;
  /** Shows a colour swatch picker beside the switch when set. */
  color?: string;
  onColorChange?(color: string): void;
  colorLabel?: string;
}

/** Compact labelled switch used by the caption panels. */
export const CaptionToggle: React.FC<CaptionToggleProps> = ({
  label,
  checked,
  onChange,
  disabled = false,
  color,
  onColorChange,
  colorLabel,
}) => (
  <div className="flex items-center justify-between gap-2">
    <span className="text-[10px] text-fg-2">{label}</span>
    <div className="flex items-center gap-2">
      {color && onColorChange && (
        <input
          type="color"
          aria-label={colorLabel}
          value={color}
          onChange={(event) => onColorChange(event.currentTarget.value)}
          className="h-5 w-6 cursor-pointer rounded border border-border bg-transparent p-0"
        />
      )}
      <button
        type="button"
        role="switch"
        aria-label={label}
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-[18px] w-8 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
          checked ? "bg-accent" : "bg-bg-3"
        }`}
      >
        <span
          className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow transition-[left] ${
            checked ? "left-[16px]" : "left-[2px]"
          }`}
        />
      </button>
    </div>
  </div>
);
