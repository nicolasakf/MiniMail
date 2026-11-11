import { useEffect, useState } from "react";

import { accountLogoRequest, isFreemail, type LogoRequest } from "@shared/logos";
import { senderDomain } from "@shared/categories";
import type { Account, Provider } from "@shared/types";

import gmailLogo from "@/assets/providers/gmail.svg";
import outlookLogo from "@/assets/providers/outlook.svg";
import zohoLogo from "@/assets/providers/zoho.png";
import { useLogo } from "@/lib/logo-store";
import { cn } from "@/lib/utils";

/** The real provider logos, bundled so they work offline and need no lookup. */
const PROVIDER_LOGOS: Record<Provider, string> = {
  gmail: gmailLogo,
  outlook: outlookLogo,
  zoho: zohoLogo,
};

interface AccountMarkProps {
  account: Account;
  /** Diameter in px, not counting the ring. */
  size?: number;
  /**
   * Seats the mark on a round chip that lifts off whatever is behind it, for overlapping several
   * accounts in a stack. Bare logos have see-through gaps and uneven outlines, so stacked as they
   * are they tangle into each other; the chip gives each one the same silhouette and a shadow.
   */
  stacked?: boolean;
  className?: string;
}

/**
 * Stands for one of the user's accounts: the picture the user chose; else their Gravatar photo
 * for an address on a mailbox provider (only when "People's photos" is on); else the icon of the
 * site behind a company or university address; else the provider's mark. Only a picture or photo
 * gets a ring in the account's color; site icons and provider marks are shown bare.
 */
export function AccountMark({ account, size = 18, stacked = false, className }: AccountMarkProps) {
  const photoRequest: LogoRequest | null =
    !account.avatar && isFreemail(senderDomain(account.email))
      ? { kind: "person", email: account.email }
      : null;
  const photo = useLogo(photoRequest);
  const site = useLogo(accountLogoRequest(account));
  const picture = account.avatar ?? photo;
  const logo = picture ?? site ?? PROVIDER_LOGOS[account.provider];
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [logo]);

  // A chosen picture or photo stays a ring-framed circle; a site icon or provider logo stands
  // alone, with no white disc or ring behind it.
  const isPhoto = Boolean(picture) && !broken;
  // The ring that separates a mark from its surroundings: the account's color around a photo, or
  // for a stacked chip a gap in the page color plus a drop shadow onto the chip beneath.
  const ring = stacked
    ? "0 0 0 1.5px hsl(var(--background)), 0 2px 5px rgb(0 0 0 / 0.45)"
    : isPhoto
      ? `0 0 0 1.5px hsl(${account.hue} 70% 55%), 0 0 0 3px hsl(var(--background))`
      : undefined;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden",
        isPhoto ? "rounded-full bg-white" : stacked ? "rounded-full bg-muted" : "rounded-[22%]",
        className,
      )}
      style={{ width: size, height: size, boxShadow: ring }}
    >
      <img
        src={broken ? PROVIDER_LOGOS[account.provider] : logo}
        alt=""
        className={cn(
          // A logo sits inset on its chip; a photo fills it.
          stacked && !isPhoto ? "size-[62%]" : "size-full",
          isPhoto ? "object-cover" : "object-contain",
        )}
        onError={() => setBroken(true)}
      />
    </span>
  );
}
