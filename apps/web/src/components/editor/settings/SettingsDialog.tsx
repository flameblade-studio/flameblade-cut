import React, { useCallback } from "react";
import { Settings, Key, Plug } from "@/icons/lucide-compat";
import { Tabs, TabsList, TabsTrigger } from "@openreel/ui";
import { ToolcraftDialog as Dialog, ToolcraftDialogHeader as DialogHeader } from "@openreel/ui";
import { ToolcraftLayout as Layout, ToolcraftLayoutContent as LayoutContent } from "@openreel/ui";
import { useSettingsStore, type SettingsTab } from "../../../stores/settings-store";
import { GeneralPanel } from "./GeneralPanel";
import { ApiKeysPanel } from "./ApiKeysPanel";
import { CloudKeysSection } from "./CloudKeysSection";
import { McpPanel } from "./McpPanel";
import { useTranslation } from "react-i18next";

const isDesktop =
  typeof window !== "undefined" && window.openreel?.platform === "desktop";

/** `labelKey` is resolved with `t()` at render time so the tabs follow the language. */
const TABS: readonly { id: SettingsTab; labelKey: string; icon: typeof Settings }[] = [
  { id: "general", labelKey: "settings.tabs.general", icon: Settings },
  { id: "api-keys", labelKey: "settings.tabs.apiKeys", icon: Key },
  ...(isDesktop
    ? [{ id: "mcp" as const, labelKey: "settings.tabs.mcp", icon: Plug }]
    : []),
];

export const SettingsDialog: React.FC = () => {
  const { settingsOpen, settingsTab, closeSettings, openSettings } = useSettingsStore();
  const { t } = useTranslation();

  const setTab = useCallback((tab: SettingsTab) => {
    openSettings(tab);
  }, [openSettings]);

  return (
    <Dialog
      isOpen={settingsOpen}
      onOpenChange={(open) => !open && closeSettings()}
      width={720}
      purpose="form"
    >
      <Layout
        header={
          <DialogHeader
            title={t("settings.title")}
            subtitle={t("settings.subtitle")}
            onOpenChange={(open) => !open && closeSettings()}
            startContent={<Settings size={18} className="text-primary" aria-hidden />}
          />
        }
        content={
          <LayoutContent className="max-h-[70vh] overflow-y-auto">
            <Tabs
              value={settingsTab}
              onValueChange={(value) => setTab(value as SettingsTab)}
              className="w-full"
            >
              <TabsList
                aria-label={t("settings.title")}
                className="grid h-auto w-full gap-0.5 rounded-[7px] border border-border bg-bg-1 p-0.5"
                layoutId="settings-tabs"
                style={{
                  gridTemplateColumns: `repeat(${TABS.length}, minmax(0, 1fr))`,
                }}
              >
                {TABS.map((tab) => {
                  const Icon = tab.icon;

                  return (
                    <TabsTrigger
                      key={tab.id}
                      value={tab.id}
                      onClick={() => setTab(tab.id)}
                      className="h-8 gap-1.5 rounded-[5px] px-2 text-[12px] font-semibold text-fg-muted data-[state=active]:text-fg"
                      aria-controls={`settings-tabpanel-${tab.id}`}
                      id={`settings-tab-${tab.id}`}
                    >
                      <Icon size={14} aria-hidden />
                      <span className="truncate">{t(tab.labelKey)}</span>
                    </TabsTrigger>
                  );
                })}
              </TabsList>
            </Tabs>

            <div
              role="tabpanel"
              id={`settings-tabpanel-${settingsTab}`}
              aria-labelledby={`settings-tab-${settingsTab}`}
              className="mt-4"
            >
              {settingsTab === "general" && <GeneralPanel />}
              {settingsTab === "api-keys" && (
                <div className="space-y-6">
                  <CloudKeysSection />
                  <section className="space-y-3" aria-labelledby="other-services-title">
                    <div>
                      <h3 id="other-services-title" className="text-[14px] font-bold text-fg">
                        {t("tools.otherServices.title")}
                      </h3>
                      <p className="text-[12px] text-fg-3">{t("tools.otherServices.description")}</p>
                    </div>
                    <ApiKeysPanel />
                  </section>
                </div>
              )}
              {settingsTab === "mcp" && <McpPanel />}
            </div>
          </LayoutContent>
        }
      />
    </Dialog>
  );
};
