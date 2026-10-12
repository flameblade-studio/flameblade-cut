import React from "react";
import { TextSection, ShapeSection, SVGSection } from "../";
import { InspectorSection } from "../shell/InspectorSection";
import { useTranslation } from "react-i18next";

export interface StyleTabProps {
  clipId: string;
  showTextSection: boolean;
  showShapeSection: boolean;
  showSVGSection: boolean;
}

export const StyleTab: React.FC<StyleTabProps> = ({
  clipId,
  showTextSection,
  showShapeSection,
  showSVGSection,
}) => {
  const { t } = useTranslation();
  return (
    <>
      {showTextSection && (
        <InspectorSection title={t("inspector.sections.textProperties")} sectionId="text-properties">
          <TextSection clipId={clipId} />
        </InspectorSection>
      )}
      {showShapeSection && (
        <InspectorSection title={t("inspector.sections.shapeProperties")} sectionId="shape-properties">
          <ShapeSection clipId={clipId} />
        </InspectorSection>
      )}
      {showSVGSection && (
        <InspectorSection title={t("inspector.sections.svgProperties")}>
          <SVGSection clipId={clipId} />
        </InspectorSection>
      )}
    </>
  );
};
