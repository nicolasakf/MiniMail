import type { CSSProperties, ReactNode } from "react";

import { User } from "lucide-react";

import { EMAIL_WIDTH_REM, TEXT_SIZE_PERCENT, type EmailWidth, type TextSize } from "@/lib/appearance";
import { cn } from "@/lib/utils";

import { PreviewFrame } from "./visual-fields";

/**
 * Miniatures for the Appearance tab. They are drawn with plain boxes rather than screenshots, so
 * they follow the current theme and stay sharp at any text size. Nothing in them is interactive.
 */

const LOGO_COLORS = ["bg-sky-500", "bg-rose-500", "bg-amber-500", "bg-emerald-500"];

/** A line of text, drawn as a bar. */
function Bar({ className }: { className?: string }) {
  return <div className={cn("h-1 rounded-full bg-foreground/35", className)} />;
}

function FaintBar({ className }: { className?: string }) {
  return <div className={cn("h-[3px] rounded-full bg-foreground/15", className)} />;
}

function Avatar({ index = 0, kind = "initial", small = false }: { index?: number; kind?: "initial" | "logo" | "photo"; small?: boolean }) {
  const box = small ? "size-2.5" : "size-3.5";
  if (kind === "logo") {
    return <span className={cn("shrink-0 rounded-[3px]", box, LOGO_COLORS[index % LOGO_COLORS.length])} />;
  }
  if (kind === "photo") {
    return (
      <span className={cn("flex shrink-0 items-end justify-center overflow-hidden rounded-full bg-violet-400/70", box)}>
        <User className={cn("translate-y-[2px] fill-violet-50 text-violet-50", small ? "size-2" : "size-3")} strokeWidth={0} />
      </span>
    );
  }
  return <span className={cn("shrink-0 rounded-full bg-foreground/15", box)} />;
}

/** One message in a list: a picture, a subject and, optionally, the first words of the body. */
function MailRow({
  avatar,
  preview = false,
  unread = false,
  className,
}: {
  avatar?: ReactNode;
  preview?: boolean;
  unread?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      {avatar ?? <Avatar />}
      <div className="min-w-0 flex-1 space-y-[3px]">
        <Bar className={cn("w-3/5", !unread && "bg-foreground/25")} />
        {preview && <FaintBar className="w-full" />}
      </div>
    </div>
  );
}

// Color mode ---------------------------------------------------------------------------------------

const MODE_COLORS = {
  light: { bg: "#e9e7e3", side: "#dfdcd7", line: "#c9c4bb", strong: "#645f59", accent: "#c9d6ee" },
  dark: { bg: "#323539", side: "#2c2f33", line: "#454a50", strong: "#b1b2b4", accent: "#3d4e70" },
} as const;

function ThemeMock({ mode, style }: { mode: "light" | "dark"; style?: CSSProperties }) {
  const c = MODE_COLORS[mode];
  return (
    <div className="absolute inset-0 flex" style={{ background: c.bg, ...style }}>
      <div className="flex w-[22%] flex-col gap-1.5 p-2" style={{ background: c.side }}>
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-1 rounded-full" style={{ background: i === 0 ? c.strong : c.line }} />
        ))}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-2">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="flex items-center gap-1.5 rounded-[3px] px-1 py-[3px]"
            style={{ background: i === 1 ? c.accent : undefined }}
          >
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: c.line }} />
            <div className="h-1 flex-1 rounded-full" style={{ background: i === 1 ? c.strong : c.line }} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function ThemePreview({ mode }: { mode: "system" | "light" | "dark" }) {
  return (
    <PreviewFrame className="bg-transparent">
      {mode === "system" ? (
        <>
          <ThemeMock mode="light" />
          <ThemeMock mode="dark" style={{ clipPath: "inset(0 0 0 50%)" }} />
        </>
      ) : (
        <ThemeMock mode={mode} />
      )}
    </PreviewFrame>
  );
}

// Text size ----------------------------------------------------------------------------------------

/** "Aa" drawn at the same ratio the setting applies, in px so it ignores the text size currently set. */
export function TextSizeSample({ size }: { size: TextSize }) {
  const px = 10 + (TEXT_SIZE_PERCENT[size] - 87.5) * 0.32;
  return (
    <span className="font-semibold leading-none" style={{ fontSize: `${px}px` }}>
      Aa
    </span>
  );
}

/** A window with the email column drawn at a share of its width. */
export function EmailWidthSample({ width }: { width: EmailWidth }) {
  const share = (EMAIL_WIDTH_REM[width] / EMAIL_WIDTH_REM.wider) * 100;
  return (
    <span className="flex h-7 w-9 items-center justify-center rounded-[3px] border border-foreground/20">
      <span className="h-5 rounded-[2px] bg-foreground/30" style={{ width: `${share}%` }} />
    </span>
  );
}

/** A message page: white, or the theme's own surface, with a few lines of text on it. */
export function EmailBackgroundSample({ background }: { background: "white" | "theme" }) {
  const white = background === "white";
  return (
    <span
      className={`flex h-7 w-9 flex-col justify-center gap-[3px] rounded-[3px] border border-foreground/20 px-1.5 ${white ? "bg-white" : "bg-card"}`}
    >
      <span className={`h-[3px] w-full rounded-full ${white ? "bg-zinc-400" : "bg-foreground/40"}`} />
      <span className={`h-[3px] w-2/3 rounded-full ${white ? "bg-zinc-400" : "bg-foreground/40"}`} />
    </span>
  );
}

// Lists --------------------------------------------------------------------------------------------
// The window reduced to a few grey shapes: category blocks and message lines. No rail, no header.

/** The window: a frame with `children` stacked inside. */
function AppMock({ children }: { children: ReactNode }) {
  return <PreviewFrame className="flex aspect-[4/3] flex-col gap-1 p-1.5">{children}</PreviewFrame>;
}

/** A category as one wide block. */
function CategoryRow({ selected = false }: { selected?: boolean }) {
  return <div className={cn("h-3 shrink-0 rounded-[3px]", selected ? "bg-foreground/25" : "bg-foreground/10")} />;
}

/** A category as a small block, for the row of cards across the top. */
function CategoryCard({ selected = false }: { selected?: boolean }) {
  return <div className={cn("h-5 rounded-[3px]", selected ? "bg-foreground/25" : "bg-foreground/10")} />;
}

/** A message: one line. */
function MessageRow({ selected = false }: { selected?: boolean }) {
  return <div className={cn("h-1 shrink-0 rounded-full", selected ? "bg-foreground/40" : "bg-foreground/20")} />;
}

/** The Smart view with its categories as rows (horizontal) or as cards across the top (vertical). */
export function CategoryLayoutPreview({ layout }: { layout: "horizontal" | "vertical" }) {
  return (
    <AppMock>
      {layout === "horizontal" ? (
        [0, 1, 2].map((i) => <CategoryRow key={i} selected={i === 0} />)
      ) : (
        <div className="grid shrink-0 grid-cols-3 gap-1">
          {[0, 1, 2].map((i) => (
            <CategoryCard key={i} selected={i === 0} />
          ))}
        </div>
      )}
      {[0, 1, 2].map((i) => (
        <MessageRow key={i} />
      ))}
    </AppMock>
  );
}

/** Split view off: the list fills the window. On: a narrow list beside the conversation being read. */
export function SplitViewPreview({ split }: { split: boolean }) {
  if (!split) {
    return (
      <AppMock>
        {[0, 1, 2, 3, 4].map((i) => (
          <MessageRow key={i} />
        ))}
      </AppMock>
    );
  }
  return (
    <AppMock>
      <div className="flex min-h-0 flex-1 gap-1">
        <div className="flex w-2/5 shrink-0 flex-col gap-1">
          {[0, 1, 2, 3].map((i) => (
            <MessageRow key={i} selected={i === 0} />
          ))}
        </div>
        <div className="flex-1 rounded-[3px] bg-foreground/10" />
      </div>
    </AppMock>
  );
}

// Horizontal option cards --------------------------------------------------------------------------

/** A short strip of two messages, for the wide option cards. */
function Strip({ children }: { children: ReactNode }) {
  return (
    <PreviewFrame className="flex aspect-auto h-11 w-24 shrink-0 flex-col justify-center gap-1.5 p-2">
      {children}
    </PreviewFrame>
  );
}

/** Message previews: with a second, fainter line under each subject, or the subject alone. */
export function PreviewsPreview({ shown }: { shown: boolean }) {
  return (
    <Strip>
      {[0, 1].map((i) => (
        <MailRow key={i} avatar={<Avatar small />} preview={shown} unread={i === 0} className="gap-1" />
      ))}
    </Strip>
  );
}

/** Sender pictures: the real picture, or the plain grey circle used when none is looked up. */
export function SenderPicturesPreview({ kind, on }: { kind: "logo" | "photo"; on: boolean }) {
  return (
    <Strip>
      {[0, 1].map((i) => (
        <MailRow key={i} avatar={<Avatar kind={on ? kind : "initial"} index={i} small />} unread={i === 0} className="gap-1" />
      ))}
    </Strip>
  );
}
