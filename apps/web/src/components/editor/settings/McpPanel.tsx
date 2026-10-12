import React, { useState, useEffect, useCallback } from "react";
import { Plug, Eye, EyeOff, Copy, RefreshCw, Wifi } from "@/icons/lucide-compat";
import { ToolcraftSwitchControl } from "@openreel/ui";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftIconButton as IconButton } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { useSettingsStore } from "../../../stores/settings-store";
import { toast } from "../../../stores/notification-store";
import { i18next } from "@/i18n";
import type { OpenReelMcpStatus } from "../../../types/global";
import { useTranslation } from "react-i18next";

const isDesktop = (): boolean =>
  typeof window !== "undefined" && window.openreel?.platform === "desktop";

function clientConfigSnippet(shimPath: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        openreel: {
          command: "node",
          args: [shimPath || "<path to openreel-mcp shim>"],
        },
      },
    },
    null,
    2,
  );
}

async function copy(value: string, label: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(i18next.t("settings.mcp.copied", { label }));
  } catch {
    toast.error(i18next.t("settings.mcp.copyFailed"), i18next.t("settings.mcp.clipboardUnavailable"));
  }
}

export const McpPanel: React.FC = () => {
  const { t } = useTranslation();
  const mcpAutoAllow = useSettingsStore((s) => s.mcpAutoAllowTrustedLocal);
  const setMcpAutoAllow = useSettingsStore((s) => s.setMcpAutoAllowTrustedLocal);

  const [status, setStatus] = useState<OpenReelMcpStatus | null>(null);
  const [toolCount, setToolCount] = useState<number | null>(null);
  const [revealToken, setRevealToken] = useState(false);
  const [testing, setTesting] = useState(false);

  const refresh = useCallback(async () => {
    const bridge = window.openreel?.mcp;
    if (!bridge) return;
    try {
      const nextStatus = await bridge.getStatus();
      setStatus(nextStatus);
      if (nextStatus.running) {
        const connection = await bridge.testConnection();
        setToolCount(connection.ok ? (connection.toolCount ?? 0) : null);
      } else {
        setToolCount(null);
      }
    } catch {
      setStatus(null);
      setToolCount(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleRotate = useCallback(async () => {
    const bridge = window.openreel?.mcp;
    if (!bridge) return;
    try {
      setStatus(await bridge.rotateToken());
      toast.success(t("settings.mcp.tokenRotated"), t("settings.mcp.tokenRotatedHint"));
    } catch (err) {
      toast.error(t("settings.mcp.rotateFailed"), err instanceof Error ? err.message : t("settings.unknownError"));
    }
  }, [t]);

  const handleTest = useCallback(async () => {
    const bridge = window.openreel?.mcp;
    if (!bridge) return;
    setTesting(true);
    try {
      const result = await bridge.testConnection();
      if (result.ok) {
        setToolCount(result.toolCount ?? 0);
        toast.success(
          t("settings.mcp.connectionOk"),
          t("settings.mcp.toolsResponded", { count: result.toolCount ?? 0 }),
        );
      } else {
        setToolCount(null);
        toast.error(t("settings.mcp.connectionFailed"), result.message ?? t("settings.mcp.noResponse"));
      }
    } catch (err) {
      toast.error(t("settings.mcp.connectionFailed"), err instanceof Error ? err.message : t("settings.unknownError"));
    } finally {
      setTesting(false);
    }
  }, [t]);

  if (!isDesktop()) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Plug size={28} className="mb-3 text-text-muted" />
        <Text type="body" color="primary" className="text-sm font-medium">
          {t("settings.mcp.desktopOnly")}
        </Text>
        <Text type="supporting" color="secondary" className="mt-1 max-w-sm text-xs">
          {t("settings.mcp.desktopOnlyHint")}
        </Text>
      </div>
    );
  }

  const tokenDisplay = status?.token
    ? revealToken
      ? status.token
      : "•".repeat(32)
    : "—";

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div>
          <Text type="body" color="primary" className="text-sm font-medium">
            {t("settings.mcp.server")}
          </Text>
          <Text type="supporting" color="secondary" className="mt-0.5 text-xs">
            {t("settings.mcp.serverHint")}
          </Text>
        </div>

        <div className="flex items-center gap-2">
          <Text type="supporting" color="secondary" className="w-20 shrink-0 text-xs">
            {t("settings.mcp.status")}
          </Text>
          <Text
            type="supporting"
            className={`inline-flex items-center gap-1.5 text-xs font-medium ${
              status?.running ? "text-status-success" : "text-text-muted"
            }`}
          >
            <i
              aria-hidden
              className={`h-1.5 w-1.5 rounded-full ${
                status?.running ? "bg-status-success" : "bg-text-muted"
              }`}
            />
            {status?.running ? t("settings.mcp.running") : t("settings.mcp.stopped")}
          </Text>
        </div>

        <div className="flex items-center gap-2">
          <Text type="supporting" color="secondary" className="w-20 shrink-0 text-xs">
            {t("settings.mcp.tools")}
          </Text>
          <Text type="supporting" color="secondary" className="text-xs">
            {toolCount === null
              ? status?.running
                ? t("settings.mcp.checking")
                : "—"
              : t("settings.mcp.available", { count: toolCount })}
          </Text>
        </div>

        <div className="flex items-center gap-2">
          <Text type="supporting" color="secondary" className="w-20 shrink-0 text-xs">
            URL
          </Text>
          <code className="flex-1 font-mono text-xs bg-background rounded px-3 py-2 text-text-secondary truncate">
            {status?.url || "—"}
          </code>
          <IconButton
            label={t("settings.mcp.copyUrl")}
            onClick={() => status?.url && copy(status.url, t("settings.mcp.url"))}
            variant="ghost"
            size="sm"
            icon={<Copy size={14} aria-hidden />}
            className="text-text-muted hover:bg-background-tertiary hover:text-text-primary"
          />
        </div>

        <div className="flex items-center gap-2">
          <Text type="supporting" color="secondary" className="w-20 shrink-0 text-xs">
            {t("settings.mcp.token")}
          </Text>
          <code className="flex-1 font-mono text-xs bg-background rounded px-3 py-2 text-text-secondary truncate">
            {tokenDisplay}
          </code>
          <IconButton
            label={revealToken ? t("settings.mcp.hideToken") : t("settings.mcp.showToken")}
            onClick={() => setRevealToken((v) => !v)}
            variant="ghost"
            size="sm"
            icon={revealToken ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
            className="text-text-muted hover:bg-background-tertiary hover:text-text-primary"
          />
          <IconButton
            label={t("settings.mcp.copyToken")}
            onClick={() => status?.token && copy(status.token, t("settings.mcp.token"))}
            variant="ghost"
            size="sm"
            icon={<Copy size={14} aria-hidden />}
            className="text-text-muted hover:bg-background-tertiary hover:text-text-primary"
          />
          <IconButton
            label={t("settings.mcp.rotateToken")}
            onClick={handleRotate}
            variant="ghost"
            size="sm"
            icon={<RefreshCw size={14} aria-hidden />}
            className="text-text-muted hover:bg-background-tertiary hover:text-text-primary"
          />
        </div>

        <Button
          label={testing ? t("settings.mcp.testing") : t("settings.mcp.test")}
          size="sm"
          variant="secondary"
          onClick={handleTest}
          isDisabled={testing}
          icon={<Wifi size={14} aria-hidden />}
        />
      </div>

      <div className="h-px bg-border" />

      <div className="space-y-3">
        <div>
          <Text type="body" color="primary" className="text-sm font-medium">
            {t("settings.mcp.workflows")}
          </Text>
          <Text type="supporting" color="secondary" className="mt-0.5 text-xs">
            {t("settings.mcp.workflowsHint")}
          </Text>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {[
            [t("settings.mcp.wfEditor"), t("settings.mcp.wfEditorHint")],
            [t("settings.mcp.wfMotion"), t("settings.mcp.wfMotionHint")],
            [t("settings.mcp.wfCreation"), t("settings.mcp.wfCreationHint")],
            [t("settings.mcp.wfProject"), t("settings.mcp.wfProjectHint")],
          ].map(([label, description]) => (
            <div key={label} className="rounded-md border border-border bg-background px-3 py-2.5">
              <Text type="supporting" color="primary" className="text-xs font-medium">
                {label}
              </Text>
              <Text type="supporting" color="secondary" className="mt-1 text-[11px] leading-4">
                {description}
              </Text>
            </div>
          ))}
        </div>
      </div>

      <div className="h-px bg-border" />

      <div className="space-y-4">
        <div>
          <Text type="body" color="primary" className="text-sm font-medium">
            {t("settings.mcp.clientSetup")}
          </Text>
          <Text type="supporting" color="secondary" className="mt-0.5 text-xs">
            {t("settings.mcp.clientSetupHint")}
          </Text>
        </div>
        <div className="relative">
          <pre className="overflow-x-auto rounded bg-background px-3 py-2 font-mono text-[11px] text-text-secondary">
            {clientConfigSnippet(status?.shimPath ?? "")}
          </pre>
          <IconButton
            label={t("settings.mcp.copyConfig")}
            onClick={() =>
              copy(clientConfigSnippet(status?.shimPath ?? ""), t("settings.mcp.config"))
            }
            variant="ghost"
            size="sm"
            icon={<Copy size={14} aria-hidden />}
            className="absolute right-2 top-2 text-text-muted hover:bg-background-tertiary hover:text-text-primary"
          />
        </div>
      </div>

      <div className="h-px bg-border" />

      <div className="space-y-4">
        <Text type="body" color="primary" className="text-sm font-medium">
          {t("settings.mcp.trusted")}
        </Text>
        <div className="flex items-center justify-between">
          <div>
            <Text type="supporting" color="secondary" className="text-sm">
              {t("settings.mcp.autoAllow")}
            </Text>
            <Text type="supporting" color="secondary" className="mt-0.5 max-w-md text-xs">
              {t("settings.mcp.autoAllowHint")}
            </Text>
          </div>
          <ToolcraftSwitchControl
            ariaLabel={t("settings.mcp.autoAllow")}
            checked={mcpAutoAllow}
            onCheckedChange={setMcpAutoAllow}
            showLabel={false}
          />
        </div>
      </div>
    </div>
  );
};
