import { useState } from "react";

import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";
import { ColorPicker } from "@/components/ui/color-picker";
import { Separator } from "@/components/ui/separator";
import { useLogoSettings } from "@/hooks/use-logo-settings";
import { DEFAULT_ACCENT_COLOR, EMAIL_WIDTH_REM, setAppearance, useAppearance, type EmailWidth, type TextSize } from "@/lib/appearance";
import type { EmailBackground } from "@/lib/email-html";

import {
  CategoryLayoutPreview,
  EmailBackgroundSample,
  EmailWidthSample,
  PreviewsPreview,
  SenderPicturesPreview,
  SplitViewPreview,
  TextSizeSample,
  ThemePreview,
} from "./appearance-previews";
import { SettingsLabel, SettingsPageHeader, SettingsRow, SettingsSectionTitle } from "./fields";
import { SettingsTileField, SettingsVisualField, SettingsVisualToggle } from "./visual-fields";

const TEXT_SIZES: { value: TextSize; label: string; px: string }[] = [
  { value: "small", label: "Small", px: "14 px" },
  { value: "default", label: "Medium", px: "16 px" },
  { value: "large", label: "Large", px: "18 px" },
  { value: "larger", label: "Larger", px: "20 px" },
];

const EMAIL_WIDTHS: { value: EmailWidth; label: string }[] = [
  { value: "compact", label: "Compact" },
  { value: "default", label: "Default" },
  { value: "wide", label: "Wide" },
  { value: "wider", label: "Wider" },
];

const EMAIL_BACKGROUNDS: { value: EmailBackground; label: string; caption: string }[] = [
  { value: "white", label: "White", caption: "Always" },
  { value: "theme", label: "Theme", caption: "Beta" },
];

/** Swatches offered under the picker; the first is the built-in blue. */
const ACCENT_PRESETS = [
  DEFAULT_ACCENT_COLOR,
  "#7C3AED",
  "#DB2777",
  "#DC2626",
  "#EA580C",
  "#CA8A04",
  "#16A34A",
  "#0D9488",
  "#0891B2",
  "#475569",
] as const;

/** Theme, highlight color, text size, what lists show and which sender pictures are looked up. */
export function AppearanceTab() {
  const { theme, setTheme } = useTheme();
  const { textSize, showPreviews, categoryLayout, splitView, accentColor, emailWidth, emailBackground } = useAppearance();
  // The picker opens inside this page so the settings dialog's focus trap lets you type in its hex field.
  const [pickerContainer, setPickerContainer] = useState<HTMLDivElement | null>(null);
  const { settings: logoSettings, update: updateLogoSettings } = useLogoSettings();

  return (
    <div ref={setPickerContainer} className="flex flex-col gap-6 p-6">
      <SettingsPageHeader title="Appearance" />

      <div className="space-y-6">
        <section className="max-w-2xl space-y-3">
          <SettingsSectionTitle title="Theme" />
          <div className="space-y-2">
            <SettingsLabel label="Color mode" />
            <SettingsVisualField
              ariaLabel="Color mode"
              value={(theme as "system" | "light" | "dark" | "dimmed" | undefined) ?? "system"}
              options={[
                { value: "system", label: "System", preview: <ThemePreview mode="system" /> },
                { value: "light", label: "Light", preview: <ThemePreview mode="light" /> },
                { value: "dark", label: "Dark", preview: <ThemePreview mode="dark" /> },
                { value: "dimmed", label: "Dimmed", preview: <ThemePreview mode="dimmed" /> },
              ]}
              onValueChange={setTheme}
            />
          </div>
        </section>

        <Separator />

        <section className="max-w-2xl">
          <SettingsRow label="Highlight color">
            <div className="flex items-center gap-2">
              <ColorPicker
                aria-label="Highlight color"
                value={accentColor ?? DEFAULT_ACCENT_COLOR}
                presets={ACCENT_PRESETS}
                container={pickerContainer}
                align="start"
                onValueChange={(next) => setAppearance({ accentColor: next })}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={accentColor === null}
                onClick={() => setAppearance({ accentColor: null })}
              >
                Reset
              </Button>
            </div>
          </SettingsRow>
        </section>

        <Separator />

        <section className="max-w-2xl">
          <SettingsRow label="Text">
            <SettingsTileField
              ariaLabel="Text size"
              value={textSize}
              options={TEXT_SIZES.map(({ value, label, px }) => ({
                value,
                label,
                caption: px,
                content: <TextSizeSample size={value} />,
              }))}
              onValueChange={(next) => setAppearance({ textSize: next })}
            />
          </SettingsRow>
        </section>

        <Separator />

        <section className="max-w-2xl">
          <SettingsRow label="Email width">
            <SettingsTileField
              ariaLabel="Email width"
              value={emailWidth}
              options={EMAIL_WIDTHS.map(({ value, label }) => ({
                value,
                label,
                caption: `${Math.round(EMAIL_WIDTH_REM[value] * 16)} px`,
                content: <EmailWidthSample width={value} />,
              }))}
              onValueChange={(next) => setAppearance({ emailWidth: next })}
            />
          </SettingsRow>
        </section>

        <Separator />

        <section className="max-w-2xl">
          <SettingsRow
            label="Email background"
            info="The background emails are shown on in the dark and dimmed themes."
          >
            <SettingsTileField
              ariaLabel="Email background"
              value={emailBackground}
              options={EMAIL_BACKGROUNDS.map(({ value, label, caption }) => ({
                value,
                label,
                caption,
                content: <EmailBackgroundSample background={value} />,
              }))}
              onValueChange={(next) => setAppearance({ emailBackground: next })}
            />
          </SettingsRow>
        </section>

        <Separator />

        <section className="max-w-2xl">
          <SettingsRow
            label="Split view"
            info="The Drafts tab always uses split view."
          >
            <SettingsVisualToggle
              ariaLabel="Split view"
              size="compact"
              checked={splitView}
              onCheckedChange={(next) => setAppearance({ splitView: next })}
              on={{ label: "Beside the list", preview: <SplitViewPreview split /> }}
              off={{ label: "Full screen", preview: <SplitViewPreview split={false} /> }}
            />
          </SettingsRow>
        </section>

        <Separator />

        <section className="max-w-2xl">
          <SettingsRow
            label="Category layout"
            info="How categories are arranged in the Smart view."
            description={splitView ? "Always horizontal in the split view." : undefined}
          >
            <SettingsVisualField
              ariaLabel="Category layout"
              value={splitView ? "horizontal" : categoryLayout}
              disabled={splitView}
              size="compact"
              options={[
                { value: "horizontal", label: "Horizontal", preview: <CategoryLayoutPreview layout="horizontal" /> },
                { value: "vertical", label: "Vertical", preview: <CategoryLayoutPreview layout="vertical" /> },
              ]}
              onValueChange={(next) => setAppearance({ categoryLayout: next })}
            />
          </SettingsRow>
        </section>

        <Separator />

        <section className="max-w-2xl">
          <SettingsRow label="Message previews">
            <SettingsVisualToggle
              ariaLabel="Show message previews"
              checked={showPreviews}
              onCheckedChange={(next) => setAppearance({ showPreviews: next })}
              on={{ label: "With previews", preview: <PreviewsPreview shown /> }}
              off={{ label: "Subject only", preview: <PreviewsPreview shown={false} /> }}
            />
          </SettingsRow>
        </section>

        <Separator />

        <section className="max-w-2xl space-y-3">
          <SettingsSectionTitle title="Sender pictures" />
          <div className="space-y-2">
            <SettingsLabel label="Company logos" info="Fetched from each sender's website." />
            <SettingsVisualToggle
              ariaLabel="Company logos"
              checked={logoSettings?.companyLogos ?? true}
              disabled={!logoSettings}
              onCheckedChange={(companyLogos) => void updateLogoSettings({ companyLogos })}
              on={{ label: "Show logos", preview: <SenderPicturesPreview kind="logo" on /> }}
              off={{ label: "Plain circles", preview: <SenderPicturesPreview kind="logo" on={false} /> }}
            />
          </div>
          <div className="space-y-2">
            <SettingsLabel label="People's photos" info="Fetched from Gravatar using a hash of the sender's address." />
            <SettingsVisualToggle
              ariaLabel="People's photos"
              checked={logoSettings?.personPhotos ?? false}
              disabled={!logoSettings}
              onCheckedChange={(personPhotos) => void updateLogoSettings({ personPhotos })}
              on={{ label: "Show photos", preview: <SenderPicturesPreview kind="photo" on /> }}
              off={{ label: "Plain circles", preview: <SenderPicturesPreview kind="photo" on={false} /> }}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
