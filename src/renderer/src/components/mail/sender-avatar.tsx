import { useEffect, useMemo, useState } from "react";

import { brandFallbackFor, type LogoRequest } from "@shared/logos";
import type { Contact } from "@shared/types";

import { useEdgeColor } from "@/lib/edge-color";
import { initialsOf, senderHue } from "@/lib/format";
import { useLogo } from "@/lib/logo-store";
import { cn } from "@/lib/utils";

interface SenderAvatarProps {
  contact: Contact;
  /** Outer size in px, ring included. */
  size?: number;
  className?: string;
  /** Which logo or photo the sender qualifies for (see `logoRequestFor`); initials when none arrives. */
  logo?: LogoRequest | null;
}

/**
 * A rounded-square (squircle) avatar for a sender. With a logo or photo the picture fills the
 * whole shape: no ring, no white border. A logo on a solid background (most app icons) fills it
 * edge to edge, and the tile takes that background's color so nothing shows between them; a
 * logo with a transparent background sits on white with some breathing room. Otherwise it shows
 * the sender's initials on a tile in their color. Someone at a company with no photo of their own
 * gets the company's logo.
 */
export function SenderAvatar({ contact, size = 36, className, logo }: SenderAvatarProps) {
  const hue = senderHue(contact.email);
  const photoImage = useLogo(logo);
  const fallback = useMemo(() => brandFallbackFor(logo), [logo]);
  const brandImage = useLogo(photoImage ? null : fallback);
  const image = photoImage ?? brandImage;
  const isPhoto = photoImage !== null && logo?.kind === "person";
  const edge = useEdgeColor(isPhoto ? null : image);
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [image]);

  const radius = Math.round(size * 0.3);
  const shape = { width: size, height: size, borderRadius: radius };

  if (image && !broken) {
    const photo = isPhoto;
    const fullBleed = photo || edge !== null;
    return (
      <span
        className={cn("corner-squircle inline-flex shrink-0 overflow-hidden", className)}
        style={{ ...shape, background: photo ? undefined : (edge ?? "#fff"), boxShadow: "inset 0 0 0 1px hsl(0 0% 50% / 0.18)" }}
      >
        <img
          src={image}
          alt=""
          onError={() => setBroken(true)}
          className={cn("size-full", fullBleed ? "object-cover" : "object-contain")}
          style={fullBleed ? undefined : { padding: Math.max(2, Math.round(size * 0.14)) }}
        />
      </span>
    );
  }

  return (
    <span
      className={cn("corner-squircle inline-flex shrink-0 items-center justify-center font-semibold", className)}
      style={{
        ...shape,
        background: `hsl(${hue} 45% 22%)`,
        color: `hsl(${hue} 80% 88%)`,
        fontSize: Math.max(9, Math.round(size * 0.38)),
      }}
    >
      {initialsOf(contact)}
    </span>
  );
}
