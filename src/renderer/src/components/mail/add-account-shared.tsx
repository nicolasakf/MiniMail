import type { ReactNode } from "react";

import { ArrowLeft, ChevronRight, Mail } from "lucide-react";

import type { Provider } from "@shared/types";

import gmailLogo from "@/assets/providers/gmail.svg";
import outlookLogo from "@/assets/providers/outlook.svg";
import zohoLogo from "@/assets/providers/zoho.png";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { SettingsPageHeader } from "../settings/fields";

/** The providers offered in the picker. Zoho is an IMAP account with its servers preset. */
export type SetupProvider = Provider;

interface ProviderChoice {
  provider: SetupProvider;
  title: string;
  subtitle: string;
}

const CHOICES: ProviderChoice[] = [
  { provider: "gmail", title: "Google", subtitle: "Gmail and Google Workspace" },
  { provider: "outlook", title: "Microsoft", subtitle: "Outlook, Hotmail and Microsoft 365" },
  { provider: "zoho", title: "Zoho Mail", subtitle: "Zoho and Zoho Workplace" },
  { provider: "imap", title: "Other email", subtitle: "iCloud, Fastmail, or any IMAP account" },
];

const LOGOS: Partial<Record<SetupProvider, string>> = {
  gmail: gmailLogo,
  outlook: outlookLogo,
  zoho: zohoLogo,
};

export function ProviderBadge({ provider, size = "md" }: { provider: SetupProvider; size?: "md" | "lg" }) {
  const logo = LOGOS[provider];
  return (
    <span
      className={cn(
        "corner-squircle flex shrink-0 items-center justify-center rounded-xl bg-muted",
        size === "lg" ? "size-12" : "size-10",
      )}
    >
      {logo ? (
        <img src={logo} alt="" className={cn("object-contain", size === "lg" ? "size-7" : "size-6")} />
      ) : (
        <Mail aria-hidden="true" className={cn("text-muted-foreground", size === "lg" ? "size-6" : "size-5")} />
      )}
    </span>
  );
}

/** Step one of adding an account: pick where the mail lives. Nothing is guessed from an address. */
export function ChooseProvider({
  canGoBack,
  onBack,
  onChoose,
}: {
  canGoBack: boolean;
  onBack: () => void;
  onChoose: (provider: SetupProvider) => void;
}) {
  return (
    <>
      {canGoBack && <BackButton onClick={onBack}>Accounts</BackButton>}
      <SettingsPageHeader title="Add an account" description="Choose your email provider to get started." />
      <ul className="grid gap-2">
        {CHOICES.map(({ provider, title, subtitle }) => (
          <li key={provider}>
            <button
              type="button"
              onClick={() => onChoose(provider)}
              className="corner-squircle group flex w-full items-center gap-3 rounded-xl border border-border p-3 text-left outline-none transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ProviderBadge provider={provider} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{title}</span>
                <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>
              </span>
              <ChevronRight
                aria-hidden="true"
                className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
              />
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

export function BackButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="-ml-2 justify-self-start self-start text-muted-foreground"
      disabled={disabled}
      onClick={onClick}
    >
      <ArrowLeft /> {children}
    </Button>
  );
}

/** Step two: the chosen provider's badge and name above its form, with a way back to the picker. */
export function ProviderFormHeader({
  provider,
  title,
  description,
  disabled,
  onBack,
}: {
  provider: SetupProvider;
  title: string;
  description: string;
  disabled?: boolean;
  onBack: () => void;
}) {
  return (
    <>
      <BackButton onClick={onBack} disabled={disabled}>
        Choose another provider
      </BackButton>
      <div className="flex items-center gap-3">
        <ProviderBadge provider={provider} size="lg" />
        <div className="min-w-0 space-y-0.5">
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
    </>
  );
}
