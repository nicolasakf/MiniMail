import { useState } from "react";

import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";
import { ColorPicker } from "@/components/ui/color-picker";
import { Separator } from "@/components/ui/separator";
import { useLogoSettings } from "@/hooks/use-logo-settings";
import { DEFAULT_ACCENT_COLOR, setAppearance, useAppearance, type TextSize } from "@/lib/appearance";

import {
  CategoryLayoutPreview,
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
  const { textSize, showPreviews, categoryLayout, splitView, accentColor } = useAppearance();
  // The picker opens inside this page so the settings dialog's focus trap lets you type in its hex field.
  const [pickerContainer, setPickerContainer] = useState<HTMLDivElement | null>(null);
  const { settings: logoSettings, update: updateLogoSettings } = useLogoSettings();

  return (
    <div ref={setPickerContainer} className="flex flex-col gap-6 p-6">
      <SettingsPageHeader title="Appearance" description="Control the theme, the highlight color, the size of text, what lists show and which sender pictures appear." />

      <div className="space-y-6">
        <section className="max-w-2xl space-y-3">
          <SettingsSectionTitle title="Theme" />
          <div className="space-y-2">
            <SettingsLabel label="Color mode" info="System follows your Mac's light or dark setting." />
            <SettingsVisualField
              ariaLabel="Color mode"
              value={(theme as "system" | "light" | "dark" | undefined) ?? "system"}
              options={[
                { value: "system", label: "System", preview: <ThemePreview mode="system" /> },
                { value: "light", label: "Light", preview: <ThemePreview mode="light" /> },
                { value: "dark", label: "Dark", preview: <ThemePreview mode="dark" /> },
              ]}
              onValueChange={setTheme}
            />
          </div>
        </section>

        <Separator />

        <section className="max-w-2xl">
          <SettingsRow
            label="Highlight color"
            info="Used for the selected conversation, unread dots and counts, links, and the Compose button."
          >
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
          <SettingsRow
            label="Text"
            info="Scales the whole interface, from the lists to the dialogs. Message bodies follow it too."
          >
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

        <section className="max-w-2xl space-y-3">
          <SettingsSectionTitle title="Lists" />
          <div className="space-y-2">
            <SettingsLabel label="Split view" info="Click a conversation to read it beside the list, without opening it full screen." />
            <SettingsVisualToggle
              ariaLabel="Split view"
              size="regular"
              checked={splitView}
              onCheckedChange={(next) => setAppearance({ splitView: next })}
              on={{ label: "Beside the list", preview: <SplitViewPreview split /> }}
              off={{ label: "Full screen", preview: <SplitViewPreview split={false} /> }}
            />
          </div>
          <div className="space-y-2">
            <SettingsLabel
              label="Category layout"
              info="How the Smart view shows your categories. Horizontal is one row per category; Vertical is a grid of cards, each listing its senders."
            />
            <SettingsVisualField
              ariaLabel="Category layout"
              value={splitView ? "horizontal" : categoryLayout}
              disabled={splitView}
              size="regular"
              options={[
                { value: "horizontal", label: "Horizontal", preview: <CategoryLayoutPreview layout="horizontal" /> },
                { value: "vertical", label: "Vertical", preview: <CategoryLayoutPreview layout="vertical" /> },
              ]}
              onValueChange={(next) => setAppearance({ categoryLayout: next })}
            />
            {splitView && (
              <p className="text-xs text-muted-foreground">Categories are always horizontal in the split view.</p>
            )}
          </div>
          <div className="space-y-2">
            <SettingsLabel label="Message previews" info="The first words of each message after its subject." />
            <SettingsVisualToggle
              ariaLabel="Show message previews"
              checked={showPreviews}
              onCheckedChange={(next) => setAppearance({ showPreviews: next })}
              on={{ label: "With previews", preview: <PreviewsPreview shown /> }}
              off={{ label: "Subject only", preview: <PreviewsPreview shown={false} /> }}
            />
          </div>
        </section>

        <Separator />

        <section className="max-w-2xl space-y-3">
          <SettingsSectionTitle
            title="Sender pictures"
            info="Each picture is looked up outside MiniMail, so you choose which sources are used."
          />
          <div className="space-y-2">
            <SettingsLabel label="Company logos" info="Fetched from each sender's own site." />
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
            <SettingsLabel label="People's photos" info="Looked up on Gravatar; shares a hash of each sender's address." />
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
