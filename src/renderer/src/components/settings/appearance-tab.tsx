import { useTheme } from "next-themes";

import { Separator } from "@/components/ui/separator";
import { useLogoSettings } from "@/hooks/use-logo-settings";
import { setAppearance, useAppearance, type CategoryLayout, type TextSize } from "@/lib/appearance";

import { SettingsLabel, SettingsPageHeader, SettingsSectionTitle, SettingsSegmentedField, SettingsSwitchField } from "./fields";

const THEMES = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const;

const TEXT_SIZE_OPTIONS: { value: TextSize; label: string }[] = [
  { value: "small", label: "Small" },
  { value: "default", label: "Default" },
  { value: "large", label: "Large" },
  { value: "larger", label: "Larger" },
];

const CATEGORY_LAYOUT_OPTIONS: { value: CategoryLayout; label: string }[] = [
  { value: "horizontal", label: "Horizontal" },
  { value: "vertical", label: "Vertical" },
];

/** Theme, text size, what lists show and which sender pictures are looked up. */
export function AppearanceTab() {
  const { theme, setTheme } = useTheme();
  const { textSize, showPreviews, categoryLayout } = useAppearance();
  const { settings: logoSettings, update: updateLogoSettings } = useLogoSettings();

  return (
    <div className="flex flex-col gap-6 p-6">
      <SettingsPageHeader title="Appearance" description="Control the theme, the size of text, what lists show and which sender pictures appear." />

      <div className="space-y-6">
        <section className="max-w-2xl space-y-3">
          <SettingsSectionTitle title="Theme" />
          <div className="space-y-2">
            <SettingsLabel label="Color mode" info="System follows your Mac's light or dark setting." />
            <SettingsSegmentedField
              ariaLabel="Color mode"
              value={(theme as (typeof THEMES)[number]["value"] | undefined) ?? "system"}
              options={THEMES}
              onValueChange={setTheme}
            />
          </div>
        </section>

        <Separator />

        <section className="max-w-2xl space-y-3">
          <SettingsSectionTitle title="Text" />
          <div className="space-y-2">
            <SettingsLabel
              label="Text size"
              info="Scales the whole interface, from the lists to the dialogs. Message bodies follow it too."
            />
            <SettingsSegmentedField
              ariaLabel="Text size"
              value={textSize}
              options={TEXT_SIZE_OPTIONS}
              onValueChange={(next) => setAppearance({ textSize: next })}
            />
            <p className="text-xs text-muted-foreground">
              Small is 14 px, Default 16 px, Large 18 px and Larger 20 px.
            </p>
          </div>
        </section>

        <Separator />

        <section className="max-w-2xl space-y-3">
          <SettingsSectionTitle title="Lists" />
          <div className="space-y-2">
            <SettingsLabel
              label="Category layout"
              info="How the Smart view shows your categories. Horizontal is one row per category; Vertical is a grid of cards, each listing its senders."
            />
            <SettingsSegmentedField
              ariaLabel="Category layout"
              value={categoryLayout}
              options={CATEGORY_LAYOUT_OPTIONS}
              onValueChange={(next) => setAppearance({ categoryLayout: next })}
            />
          </div>
          <SettingsSwitchField
            id="appearance-previews"
            label="Show message previews"
            description="The first words of each message after its subject."
            checked={showPreviews}
            onCheckedChange={(next) => setAppearance({ showPreviews: next })}
          />
        </section>

        <Separator />

        <section className="max-w-2xl space-y-3">
          <SettingsSectionTitle
            title="Sender pictures"
            info="Each picture is looked up outside MiniMail, so you choose which sources are used."
          />
          <SettingsSwitchField
            id="appearance-company-logos"
            label="Company logos"
            description="Fetched from each sender's own site."
            checked={logoSettings?.companyLogos ?? true}
            disabled={!logoSettings}
            onCheckedChange={(companyLogos) => void updateLogoSettings({ companyLogos })}
          />
          <SettingsSwitchField
            id="appearance-person-photos"
            label="People's photos"
            description="Looked up on Gravatar; shares a hash of each sender's address."
            checked={logoSettings?.personPhotos ?? false}
            disabled={!logoSettings}
            onCheckedChange={(personPhotos) => void updateLogoSettings({ personPhotos })}
          />
        </section>
      </div>
    </div>
  );
}
