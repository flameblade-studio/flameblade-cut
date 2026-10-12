import React, { useState, useCallback } from "react";
import { Lock, Eye, EyeOff, ShieldCheck, AlertTriangle } from "@/icons/lucide-compat";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftDialog as Dialog, ToolcraftDialogHeader as DialogHeader } from "@openreel/ui";
import { ToolcraftIconButton as IconButton } from "@openreel/ui";
import { ToolcraftLayout as Layout, ToolcraftLayoutContent as LayoutContent, ToolcraftLayoutFooter as LayoutFooter } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { ToolcraftTextInputControl } from "@openreel/ui";
import { useTranslation } from "react-i18next";

interface MasterPasswordDialogProps {
  isOpen: boolean;
  onClose: () => void;
  mode: "setup" | "unlock" | "change";
  onSubmit: (password: string, newPassword?: string) => Promise<boolean>;
}

export const MasterPasswordDialog: React.FC<MasterPasswordDialogProps> = ({
  isOpen,
  onClose,
  mode,
  onSubmit,
}) => {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const resetForm = useCallback(() => {
    setPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setShowPassword(false);
    setShowNewPassword(false);
    setError(null);
    setLoading(false);
  }, []);

  const handleClose = useCallback(() => {
    resetForm();
    onClose();
  }, [onClose, resetForm]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (mode === "setup") {
      if (password.length < 8) {
        setError(t("settings.password.min8"));
        return;
      }
      if (password !== confirmPassword) {
        setError(t("settings.password.mismatch"));
        return;
      }
    }

    if (mode === "change") {
      if (newPassword.length < 8) {
        setError(t("settings.password.newMin8"));
        return;
      }
      if (newPassword !== confirmPassword) {
        setError(t("settings.password.newMismatch"));
        return;
      }
    }

    setLoading(true);
    try {
      const success = await onSubmit(
        password,
        mode === "change" ? newPassword : undefined,
      );
      if (success) {
        resetForm();
      } else {
        setError(
          mode === "unlock"
            ? t("settings.password.incorrect")
            : t("settings.password.opFailed"),
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("settings.password.errorOccurred"));
    } finally {
      setLoading(false);
    }
  }, [t, mode, password, newPassword, confirmPassword, onSubmit, resetForm]);

  const titles = {
    setup: t("settings.password.titleSetup"),
    unlock: t("settings.password.titleUnlock"),
    change: t("settings.password.titleChange"),
  };

  const descriptions = {
    setup: t("settings.password.descSetup"),
    unlock: t("settings.password.descUnlock"),
    change: t("settings.password.descChange"),
  };

  return (
    <Dialog
      isOpen={isOpen}
      onOpenChange={(open) => !open && handleClose()}
      width={448}
      purpose="form"
    >
      <Layout
        header={
          <DialogHeader
            title={titles[mode]}
            subtitle={descriptions[mode]}
            onOpenChange={(open) => !open && handleClose()}
            startContent={<Lock size={18} className="text-primary" aria-hidden />}
          />
        }
        content={
          <LayoutContent>
        <form id="master-password-form" onSubmit={handleSubmit} className="space-y-4">
          {mode === "change" && (
            <div className="space-y-2">
              <div className="relative">
                <ToolcraftTextInputControl
                  label={t("settings.password.current")}
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={setPassword}
                  placeholder={t("settings.password.enterCurrent")}
                  hasAutoFocus
                  width="100%"
                  className="pr-10"
                />
                <IconButton
                  label={showPassword ? t("settings.password.hide") : t("settings.password.show")}
                  onClick={() => setShowPassword(!showPassword)}
                  variant="ghost"
                  size="sm"
                  icon={showPassword ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
                />
              </div>
            </div>
          )}

          {(mode === "setup" || mode === "unlock") && (
            <div className="space-y-2">
              <div className="relative">
                <ToolcraftTextInputControl
                  label={mode === "setup" ? t("settings.password.password") : t("settings.password.master")}
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={setPassword}
                  placeholder={
                    mode === "setup"
                      ? t("settings.password.min8Placeholder")
                      : t("settings.password.enterMaster")
                  }
                  hasAutoFocus
                  width="100%"
                  className="pr-10"
                />
                <IconButton
                  label={showPassword ? t("settings.password.hide") : t("settings.password.show")}
                  onClick={() => setShowPassword(!showPassword)}
                  variant="ghost"
                  size="sm"
                  icon={showPassword ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
                />
              </div>
            </div>
          )}

          {(mode === "setup" || mode === "change") && (
            <>
              <div className="space-y-2">
                <div className="relative">
                  <ToolcraftTextInputControl
                    label={mode === "change" ? t("settings.password.new") : t("settings.password.confirm")}
                    type={showNewPassword ? "text" : "password"}
                    value={mode === "change" ? newPassword : confirmPassword}
                    onChange={(value) =>
                      mode === "change"
                        ? setNewPassword(value)
                        : setConfirmPassword(value)
                    }
                    placeholder={
                      mode === "change"
                        ? t("settings.password.min8Placeholder")
                        : t("settings.password.repeat")
                    }
                    width="100%"
                    className="pr-10"
                  />
                  <IconButton
                    label={showNewPassword ? t("settings.password.hide") : t("settings.password.show")}
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    variant="ghost"
                    size="sm"
                    icon={showNewPassword ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
                  />
                </div>
              </div>

              {mode === "change" && (
                <div className="space-y-2">
                  <ToolcraftTextInputControl
                    label={t("settings.password.confirmNew")}
                    type={showNewPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={setConfirmPassword}
                    placeholder={t("settings.password.repeatNew")}
                    width="100%"
                  />
                </div>
              )}
            </>
          )}

          {error && (
            <Card variant="red" padding={2} className="flex items-center gap-2 bg-error/10 text-sm text-error">
              <AlertTriangle size={14} />
              {error}
            </Card>
          )}

          {mode === "setup" && (
            <Card variant="muted" padding={2} className="flex items-start gap-2 bg-background-secondary">
              <ShieldCheck size={14} className="mt-0.5 shrink-0 text-primary" />
              <Text type="supporting" color="secondary" className="text-xs">
                {t("settings.password.pbkdf2")}
              </Text>
            </Card>
          )}
        </form>
          </LayoutContent>
        }
        footer={
          <LayoutFooter hasDivider>
            <div className="flex justify-end gap-2">
              <Button
                label={t("settings.password.cancel")}
                variant="secondary"
                onClick={handleClose}
                isDisabled={loading}
              />
              <Button
                label={
                  loading
                    ? t("settings.password.processing")
                    : mode === "setup"
                      ? t("settings.password.setPassword")
                      : mode === "unlock"
                        ? t("settings.password.unlock")
                        : t("settings.password.changePassword")
                }
                type="submit"
                form="master-password-form"
                isDisabled={loading}
                variant="primary"
              />
            </div>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
};
