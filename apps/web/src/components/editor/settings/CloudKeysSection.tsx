/**
 * Settings → API keys: the Azure Speech and OpenAI keys used by voiceover,
 * prompt translation and AI highlights. Keys are write-only here: the typed
 * value goes straight to the desktop app's OS-encrypted KeyStore and the
 * field is cleared; only the configured status is ever shown.
 */
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Cloud, ShieldCheck, Sparkles } from "@/icons/lucide-compat";
import {
  ToolcraftButton as Button,
  ToolcraftText as Text,
  ToolcraftTextInputControl as TextInput,
} from "@openreel/ui";
import { toast } from "../../../stores/notification-store";
import { useCloudKeyStatus, useCloudKeyStore } from "../../../services/cloud-keys/cloud-key-store";
import { getVoiceBridge, type CloudVoiceEngine } from "../../../services/voiceover/voiceover-client";
import { useVoiceoverSettings } from "../../../services/voiceover/voiceover-settings";

const KeyStatusPill: React.FC<{ configured: boolean }> = ({ configured }) => {
  const { t } = useTranslation();
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${
        configured ? "bg-status-success/15 text-status-success" : "bg-bg-2 text-fg-3"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${configured ? "bg-status-success" : "bg-fg-3/60"}`} aria-hidden />
      {configured ? t("voice.panel.setup.configured") : t("voice.panel.setup.notConfigured")}
    </span>
  );
};

interface KeyCardProps {
  engine: CloudVoiceEngine;
  configured: boolean;
  children?: React.ReactNode;
}

const ENGINE_ICON: Record<CloudVoiceEngine, React.ElementType> = { azure: Cloud, openai: Sparkles };

const KeyCard: React.FC<KeyCardProps> = ({ engine, configured, children }) => {
  const { t } = useTranslation();
  const save = useCloudKeyStore((state) => state.save);
  const remove = useCloudKeyStore((state) => state.remove);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const label = engine === "azure" ? t("voice.panel.setup.azureKey") : t("voice.panel.setup.openaiKey");
  const Icon = ENGINE_ICON[engine];

  const submit = async () => {
    if (!draft.trim()) return;
    setBusy(true);
    try {
      await save(engine, draft.trim());
      toast.success(t("voice.panel.setup.saved"));
    } catch {
      // The KeyStore error text can mention OS storage details only; never the key.
      toast.error(t("voice.panel.setup.saveFailed"));
    } finally {
      setDraft("");
      setBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true);
    try {
      await remove(engine);
      toast.success(t("voice.panel.setup.removed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-border bg-bg-1 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <Icon size={16} className="mt-0.5 shrink-0 text-fg-3" aria-hidden />
          <div className="min-w-0">
            <Text weight="bold" display="block" className="text-[13px]">
              {label}
            </Text>
            <Text type="supporting" color="secondary" display="block" className="text-[12px]">
              {t(`voice.keys.use.${engine}`)}
            </Text>
          </div>
        </div>
        <KeyStatusPill configured={configured} />
      </div>
      <div className="flex items-end gap-2">
        <TextInput
          type="password"
          autoComplete="off"
          spellCheck={false}
          ariaLabel={label}
          value={draft}
          onChange={setDraft}
          placeholder={t("voice.panel.setup.keyPlaceholder")}
          size="sm"
          width="100%"
          className="min-w-0 flex-1"
          onKeyDown={(event) => {
            if (event.key === "Enter") void submit();
          }}
        />
        <Button label={t("voice.panel.setup.save")} size="sm" variant="primary" isDisabled={busy || !draft.trim()} onClick={() => void submit()} />
        {configured && <Button label={t("voice.panel.setup.remove")} size="sm" variant="ghost" isDisabled={busy} onClick={() => void clear()} />}
      </div>
      {children}
    </div>
  );
};

const AzureRegionField: React.FC = () => {
  const { t } = useTranslation();
  const azureRegion = useVoiceoverSettings((state) => state.azureRegion);
  const setAzureRegion = useVoiceoverSettings((state) => state.setAzureRegion);
  const [draft, setDraft] = useState(azureRegion);
  return (
    <TextInput
      label={t("voice.panel.setup.region")}
      value={draft}
      onChange={setDraft}
      onBlur={() => setAzureRegion(draft)}
      placeholder={t("voice.panel.setup.regionPlaceholder")}
      size="sm"
      width="100%"
      spellCheck={false}
    />
  );
};

/** Rendered only in the desktop app, where the KeyStore exists. */
export const CloudKeysSection: React.FC = () => {
  const { t } = useTranslation();
  const status = useCloudKeyStatus();
  if (getVoiceBridge() === null) return null;

  return (
    <section className="space-y-3" aria-labelledby="cloud-keys-title">
      <div>
        <Text as="h3" id="cloud-keys-title" weight="bold" display="block" className="text-[14px]">
          {t("voice.keys.title")}
        </Text>
        <Text type="supporting" color="secondary" display="block" className="text-[12px]">
          {t("voice.keys.description")}
        </Text>
      </div>
      <KeyCard engine="openai" configured={status?.openai ?? false} />
      <KeyCard engine="azure" configured={status?.azure ?? false}>
        <AzureRegionField />
      </KeyCard>
      <div className="flex items-start gap-1.5">
        <ShieldCheck size={13} className="mt-px shrink-0 text-status-success" aria-hidden />
        <Text type="supporting" color="secondary" className="text-[11.5px] leading-relaxed">
          {t("voice.panel.setup.keyHint")}
        </Text>
      </div>
    </section>
  );
};
