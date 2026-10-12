import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { KeyRound, ShieldCheck } from "@/icons/lucide-compat";
import {
  ToolcraftButton as Button,
  ToolcraftCollapsible as Collapsible,
  ToolcraftText as Text,
  ToolcraftTextInputControl as TextInput,
} from "@openreel/ui";
import { toast } from "../../../stores/notification-store";
import {
  deleteCloudKey,
  saveCloudKey,
  type CloudVoiceEngine,
} from "../../../services/voiceover/voiceover-client";
import { useVoiceoverSettings } from "../../../services/voiceover/voiceover-settings";

interface StatusPillProps {
  configured: boolean;
}

export const KeyStatusPill: React.FC<StatusPillProps> = ({ configured }) => {
  const { t } = useTranslation();
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-semibold ${
        configured ? "bg-status-success/15 text-status-success" : "bg-bg-2 text-fg-3"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${configured ? "bg-status-success" : "bg-fg-3/60"}`} aria-hidden />
      {configured ? t("voice.panel.setup.configured") : t("voice.panel.setup.notConfigured")}
    </span>
  );
};

interface KeyRowProps {
  engine: CloudVoiceEngine;
  configured: boolean;
  onChanged(): void;
}

/** Write-only key field: the value goes straight to the encrypted KeyStore and is cleared. */
const KeyRow: React.FC<KeyRowProps> = ({ engine, configured, onChanged }) => {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const label = engine === "azure" ? t("voice.panel.setup.azureKey") : t("voice.panel.setup.openaiKey");

  const save = async () => {
    if (!draft.trim()) return;
    setBusy(true);
    try {
      await saveCloudKey(engine, draft);
      toast.success(t("voice.panel.setup.saved"));
      onChanged();
    } catch {
      // The KeyStore error text can mention OS storage details only; never the key.
      toast.error(t("voice.panel.setup.saveFailed"));
    } finally {
      setDraft("");
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await deleteCloudKey(engine);
      toast.success(t("voice.panel.setup.removed"));
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Text type="supporting" weight="bold" className="text-[10px]">
          {label}
        </Text>
        <KeyStatusPill configured={configured} />
      </div>
      <div className="flex items-end gap-1.5">
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
            if (event.key === "Enter") void save();
          }}
        />
        <Button label={t("voice.panel.setup.save")} size="sm" variant="primary" isDisabled={busy || !draft.trim()} onClick={() => void save()} />
        {configured && (
          <Button label={t("voice.panel.setup.remove")} size="sm" variant="ghost" isDisabled={busy} onClick={() => void remove()} />
        )}
      </div>
    </div>
  );
};

interface VoiceKeySetupProps {
  engine: CloudVoiceEngine;
  configured: boolean;
  onChanged(): void;
}

export const VoiceKeySetup: React.FC<VoiceKeySetupProps> = ({ engine, configured, onChanged }) => {
  const { t } = useTranslation();
  const azureRegion = useVoiceoverSettings((s) => s.azureRegion);
  const setAzureRegion = useVoiceoverSettings((s) => s.setAzureRegion);
  const [regionDraft, setRegionDraft] = useState(azureRegion);
  const ready = configured && (engine !== "azure" || azureRegion.length > 0);

  return (
    <Collapsible
      key={engine}
      defaultIsOpen={!ready}
      className="rounded-lg border border-border bg-bg-1"
      triggerClassName="w-full px-3 py-2"
      contentClassName="space-y-3 px-3 pb-3"
      trigger={
        <div className="flex w-full items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <KeyRound size={12} className="text-fg-3" aria-hidden />
            <Text type="supporting" weight="bold" className="text-[10px]">
              {t("voice.panel.setup.title")}
            </Text>
          </span>
          <KeyStatusPill configured={ready} />
        </div>
      }
    >
      <KeyRow engine={engine} configured={configured} onChanged={onChanged} />
      {engine === "azure" && (
        <TextInput
          label={t("voice.panel.setup.region")}
          value={regionDraft}
          onChange={setRegionDraft}
          onBlur={() => setAzureRegion(regionDraft)}
          placeholder={t("voice.panel.setup.regionPlaceholder")}
          size="sm"
          width="100%"
          spellCheck={false}
        />
      )}
      <div className="flex items-start gap-1.5">
        <ShieldCheck size={11} className="mt-px shrink-0 text-status-success" aria-hidden />
        <Text type="supporting" color="secondary" className="text-[9px] leading-relaxed">
          {t("voice.panel.setup.keyHint")}
        </Text>
      </div>
    </Collapsible>
  );
};
