import React from "react";
import { ToolcraftSwitchControl } from "@openreel/ui";
import { ToolcraftSelectControl as Selector } from "@openreel/ui";
import { ToolcraftSliderControl } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { ToolcraftTextInputControl } from "@openreel/ui";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { BUILT_IN_EDITING_TEMPLATES } from "@openreel/core";
import type { EditingTemplate, EditingTemplateControlDefinition, EditingTemplatePrimitive } from "@openreel/core";

export const getEditingTemplateDefaultControlValues = (
  template: EditingTemplate,
): Record<string, EditingTemplatePrimitive> =>
  (template.controls || []).reduce<Record<string, EditingTemplatePrimitive>>(
    (values, control) => {
      values[control.id] = control.defaultValue;
      return values;
    },
    {},
  );

export const mergeEditingTemplateControlValues = (
  template: EditingTemplate,
  overrides: Readonly<Record<string, unknown>> | undefined,
): Record<string, EditingTemplatePrimitive> => {
  const values = getEditingTemplateDefaultControlValues(template);

  for (const control of template.controls || []) {
    const override = overrides?.[control.id];
    if (
      typeof override === "string" ||
      typeof override === "number" ||
      typeof override === "boolean"
    ) {
      values[control.id] = override;
    }
  }

  return values;
};

const BUILT_IN_RECIPE_IDS = new Set(BUILT_IN_EDITING_TEMPLATES.map((template) => template.id));

/** Localized name/description of a built-in recipe; user-made recipes keep their own text. */
export function recipeText(template: EditingTemplate, field: "name" | "description", t: TFunction): string {
  if (!BUILT_IN_RECIPE_IDS.has(template.id)) return template[field];
  return t(`tools.recipes.templates.${template.id}.${field}`, { defaultValue: template[field] });
}

/** Localized control label of a built-in recipe; user-made recipes keep their own text. */
export function recipeControlLabel(
  template: EditingTemplate,
  control: EditingTemplateControlDefinition,
  t: TFunction,
): string {
  if (!BUILT_IN_RECIPE_IDS.has(template.id)) return control.label;
  return t(`tools.recipes.controls.${control.id}`, { defaultValue: control.label });
}

interface EditingTemplateControlsProps {
  template: EditingTemplate;
  values: Record<string, EditingTemplatePrimitive>;
  onChange: (controlId: string, value: EditingTemplatePrimitive) => void;
  disabled?: boolean;
  className?: string;
}

export const EditingTemplateControls: React.FC<EditingTemplateControlsProps> = ({
  template,
  values,
  onChange,
  disabled = false,
  className,
}) => {
  const { t } = useTranslation();
  if (!template.controls || template.controls.length === 0) {
    return null;
  }

  return (
    <div className={className || "space-y-3"}>
      {template.controls.map((control) => {
        const value = values[control.id] ?? control.defaultValue;
        const label = recipeControlLabel(template, control, t);

        if (control.type === "number") {
          return (
            <div key={control.id} className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <Text type="label" weight="bold" display="block" className="text-[11px]">
                  {label}
                </Text>
                <span className="rounded-full bg-background-tertiary px-2 py-0.5 text-[10px] text-text-secondary">
                  {value}
                </span>
              </div>
              <ToolcraftSliderControl
                label={label}
                isLabelHidden
                min={control.min ?? 0}
                max={control.max ?? 100}
                step={control.step ?? 1}
                value={Number(value)}
                isDisabled={disabled}
                onChange={(nextValue: number) => onChange(control.id, nextValue)}
                valueDisplay="none"
                className="w-full disabled:cursor-not-allowed disabled:opacity-60"
              />
            </div>
          );
        }

        if (control.type === "toggle") {
          return (
            <div key={control.id} className="flex items-center justify-between gap-3">
              <Text type="label" weight="bold" display="block" className="text-[11px]">
                {label}
              </Text>
              <ToolcraftSwitchControl
                ariaLabel={label}
                checked={Boolean(value)}
                disabled={disabled}
                onCheckedChange={(nextValue) => onChange(control.id, nextValue)}
                showLabel={false}
              />
            </div>
          );
        }

        if (control.type === "select") {
          const options = control.options || [];
          const selectedIndex = Math.max(
            0,
            options.findIndex((option) => option.value === value),
          );

          return (
            <div key={control.id} className="space-y-2">
              <Text type="label" weight="bold" display="block" className="text-[11px]">
                {label}
              </Text>
              <Selector
                label={label}
                isLabelHidden
                width="100%"
                value={`${selectedIndex}`}
                isDisabled={disabled}
                options={options.map((option, index) => ({
                  value: `${index}`,
                  label: option.label,
                }))}
                onChange={(nextValue) => {
                  const option = options[Number(nextValue)];
                  if (option) {
                    onChange(control.id, option.value);
                  }
                }}
                className="h-10 w-full rounded-xl border border-border bg-background-tertiary px-3 text-xs text-text-primary focus:border-primary/50 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
              />
            </div>
          );
        }

        if (control.type === "color") {
          return (
            <div key={control.id} className="space-y-2">
              <Text type="label" weight="bold" display="block" className="text-[11px]">
                {label}
              </Text>
              <div className="flex items-center gap-3">
                <span
                  className="h-10 w-12 rounded-lg border border-border"
                  style={{ backgroundColor: String(value) }}
                  aria-hidden
                />
                <ToolcraftTextInputControl
                  label={label}
                  isLabelHidden
                  value={String(value)}
                  isDisabled={disabled}
                  onChange={(nextValue) => onChange(control.id, nextValue)}
                  className="h-10 flex-1 rounded-xl border border-border bg-background-tertiary px-3 text-xs text-text-primary placeholder:text-text-muted focus:border-primary/50 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>
            </div>
          );
        }

        return (
          <div key={control.id} className="space-y-2">
            <Text type="label" weight="bold" display="block" className="text-[11px]">
              {label}
            </Text>
            <ToolcraftTextInputControl
              label={label}
              isLabelHidden
              value={String(value)}
              isDisabled={disabled}
              onChange={(nextValue) => onChange(control.id, nextValue)}
              className="h-10 w-full rounded-xl border border-border bg-background-tertiary px-3 text-xs text-text-primary placeholder:text-text-muted focus:border-primary/50 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
            />
          </div>
        );
      })}
    </div>
  );
};
