import * as React from "react";
import { useTranslation } from "react-i18next";

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
}

function InspectorTabErrorFallback(): React.ReactElement {
  const { t } = useTranslation();
  return <div className="p-4 text-center text-xs text-fg-2">{t("visual.shell.tabError")}</div>;
}

export class InspectorTabErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <InspectorTabErrorFallback />
      );
    }
    return this.props.children;
  }
}
