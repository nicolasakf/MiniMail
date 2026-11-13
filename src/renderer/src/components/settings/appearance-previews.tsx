import type { CSSProperties, ReactNode } from "react";

import { User } from "lucide-react";

import { TEXT_SIZE_PERCENT, type TextSize } from "@/lib/appearance";
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
  light: { bg: "#ffffff", side: "#f4f4f5", line: "#d4d4d8", strong: "#71717a", accent: "#e0e7ff" },
  dark: { bg: "#18181b", side: "#27272a", line: "#3f3f46", strong: "#a1a1aa", accent: "#312e81" },
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

// Lists --------------------------------------------------------------------------------------------
// The window reduced to its structure: a rail, a header, category blocks and message rows, in grays.

/** The window: a rail on the left, a header strip on top, and `children` filling the rest. */
function AppMock({ children }: { children: ReactNode }) {
  return (
    <PreviewFrame className="flex aspect-[4/3] gap-1.5 p-1.5">
      <div className="w-3 shrink-0 rounded-[3px] bg-foreground/10" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="h-2 w-2/3 shrink-0 rounded-[2px] bg-foreground/20" />
        <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-hidden">{children}</div>
      </div>
    </PreviewFrame>
  );
}

/** A category as one wide block: an icon and a name on the left, its senders as small blocks. */
function CategoryRow({ selected = false, senders = 3 }: { selected?: boolean; senders?: number }) {
  return (
    <div className={cn("flex h-5 shrink-0 items-center gap-1.5 rounded-[4px] px-1.5", selected ? "bg-foreground/20" : "bg-foreground/10")}>
      <span className="size-2.5 shrink-0 rounded-full bg-foreground/30" />
      <span className="h-1 w-8 shrink-0 rounded-full bg-foreground/40" />
      <span className="flex flex-1 gap-1 pl-1">
        {Array.from({ length: senders }, (_, i) => (
          <span key={i} className="h-2 flex-1 rounded-[2px] bg-foreground/15" />
        ))}
      </span>
    </div>
  );
}

/** A category as a card: an icon and a name, then its senders one under the other. */
function CategoryCard({ selected = false }: { selected?: boolean }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1 rounded-[4px] p-1.5", selected ? "bg-foreground/20" : "bg-foreground/10")}>
      <span className="flex items-center gap-1">
        <span className="size-2 shrink-0 rounded-full bg-foreground/30" />
        <span className="h-1 flex-1 rounded-full bg-foreground/40" />
      </span>
      <span className="h-1 rounded-full bg-foreground/15" />
      <span className="h-1 rounded-full bg-foreground/15" />
    </div>
  );
}

/** A message in the full-width list: a picture and one long line. */
function WideMessageRow() {
  return (
    <div className="flex shrink-0 items-center gap-1.5 px-1">
      <span className="size-2.5 shrink-0 rounded-[2px] bg-foreground/25" />
      <span className="h-1 w-1/4 shrink-0 rounded-full bg-foreground/35" />
      <span className="h-1 flex-1 rounded-full bg-foreground/15" />
    </div>
  );
}

/** A message in the narrow list beside the reading pane: a picture and two short lines. */
function NarrowMessageRow({ selected = false }: { selected?: boolean }) {
  return (
    <div className={cn("flex shrink-0 items-center gap-1.5 rounded-[3px] px-1 py-1", selected && "bg-foreground/20")}>
      <span className="size-3 shrink-0 rounded-[2px] bg-foreground/25" />
      <span className="flex-1 space-y-[3px]">
        <span className="block h-1 w-3/5 rounded-full bg-foreground/35" />
        <span className="block h-1 w-full rounded-full bg-foreground/15" />
      </span>
    </div>
  );
}

/** The Smart view with its categories as rows (horizontal) or as cards across the top (vertical). */
export function CategoryLayoutPreview({ layout }: { layout: "horizontal" | "vertical" }) {
  return (
    <AppMock>
      {layout === "horizontal" ? (
        [0, 1, 2].map((i) => <CategoryRow key={i} selected={i === 0} />)
      ) : (
        <div className="grid shrink-0 grid-cols-3 gap-1.5">
          {[0, 1, 2].map((i) => (
            <CategoryCard key={i} selected={i === 0} />
          ))}
        </div>
      )}
      {[0, 1, 2, 3].map((i) => (
        <WideMessageRow key={i} />
      ))}
    </AppMock>
  );
}

/** Split view off: the list fills the window. On: a narrow list beside the conversation being read. */
export function SplitViewPreview({ split }: { split: boolean }) {
  if (!split) {
    return (
      <AppMock>
        {[0, 1].map((i) => (
          <CategoryRow key={i} />
        ))}
        {[0, 1, 2, 3].map((i) => (
          <WideMessageRow key={i} />
        ))}
      </AppMock>
    );
  }
  return (
    <AppMock>
      <div className="flex min-h-0 flex-1 gap-1.5">
        <div className="flex w-[42%] shrink-0 flex-col gap-1.5 overflow-hidden">
          <CategoryRow senders={1} />
          {[0, 1, 2].map((i) => (
            <NarrowMessageRow key={i} selected={i === 0} />
          ))}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5 rounded-[4px] bg-foreground/10 p-2">
          <span className="h-1.5 w-4/5 rounded-full bg-foreground/40" />
          <span className="h-1 w-1/3 rounded-full bg-foreground/20" />
          <span className="mt-1 h-1 rounded-full bg-foreground/15" />
          <span className="h-1 rounded-full bg-foreground/15" />
          <span className="h-1 w-2/3 rounded-full bg-foreground/15" />
        </div>
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
