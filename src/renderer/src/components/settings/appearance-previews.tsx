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
// These redraw the real window (rail, header, category rows or cards, message rows, reading pane)
// in a few dozen boxes, so each choice shows what the Smart view will actually look like.

const SENDER_COLORS = ["bg-indigo-600", "bg-lime-500", "bg-rose-600", "bg-sky-600"];
const CATEGORY_TINTS = ["bg-violet-500/30", "bg-sky-500/30", "bg-emerald-500/30", "bg-amber-500/30"];

/** The window: icon rail on the left, header on top, and `children` filling the rest. */
function AppMock({ children }: { children: ReactNode }) {
  return (
    <PreviewFrame className="flex aspect-[4/3] gap-1 p-1">
      <div className="flex w-3.5 shrink-0 flex-col items-center gap-1.5 rounded-[3px] border py-1.5">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={cn("size-1.5 rounded-[2px]", i === 1 ? "bg-blue-600" : "bg-foreground/25")} />
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex h-3 shrink-0 items-center gap-1">
          <Bar className="w-6 bg-foreground/60" />
          <span className="flex h-2 w-12 items-center gap-px rounded-[3px] border p-px">
            <span className="h-full flex-1 rounded-[2px] bg-foreground/25" />
            <span className="h-full flex-1" />
            <span className="h-full flex-1" />
          </span>
          <span className="ml-auto flex items-center gap-0.5">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className="size-1 rounded-[1px] bg-foreground/25" />
            ))}
            <span className="ml-0.5 size-2.5 rounded-full bg-blue-600" />
          </span>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-hidden">{children}</div>
      </div>
    </PreviewFrame>
  );
}

/** A sender as the real lists draw it: a colored square and a name. */
function Sender({ index, className }: { index: number; className?: string }) {
  return (
    <span className="flex items-center gap-0.5">
      <span className={cn("size-1.5 shrink-0 rounded-[1px]", SENDER_COLORS[index % SENDER_COLORS.length])} />
      <Bar className={cn("w-4 bg-foreground/30", className)} />
    </span>
  );
}

/** A category as one row: unread dot, icon, name and counts, a few senders, and a chevron. */
function CategoryRow({ index, senders = 3, selected = false }: { index: number; senders?: number; selected?: boolean }) {
  return (
    <div className={cn("flex shrink-0 items-center gap-1 rounded-[4px] border px-1 py-[3px]", selected && "border-blue-500/40 bg-blue-500/10")}>
      <span className="size-1 shrink-0 rounded-full bg-blue-500" />
      <span className={cn("size-3 shrink-0 rounded-full", CATEGORY_TINTS[index % CATEGORY_TINTS.length])} />
      <div className="w-8 shrink-0 space-y-[2px]">
        <Bar className="w-full bg-foreground/60" />
        <FaintBar className="w-1/2" />
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden pl-1">
        {Array.from({ length: senders }, (_, i) => (
          <Sender key={i} index={i + index} />
        ))}
      </div>
      <span className="h-1.5 w-0.5 shrink-0 rounded-full bg-foreground/30" />
    </div>
  );
}

/** A category as a card: icon and name, then its senders one under the other. */
function CategoryCard({ index, selected = false }: { index: number; selected?: boolean }) {
  return (
    <div className={cn("min-w-0 space-y-1 rounded-[4px] border p-1", selected && "border-blue-500/40 bg-blue-500/10")}>
      <div className="flex items-center gap-1">
        <span className={cn("size-2.5 shrink-0 rounded-full", CATEGORY_TINTS[index % CATEGORY_TINTS.length])} />
        <Bar className="w-3/5 bg-foreground/60" />
      </div>
      {[0, 1, 2].map((i) => (
        <Sender key={i} index={i + index} className="w-full flex-1" />
      ))}
    </div>
  );
}

/** A message on one line (full width): avatar, sender, subject, first words and date. */
function WideMessageRow({ index, unread = false }: { index: number; unread?: boolean }) {
  return (
    <div className="flex shrink-0 items-center gap-1 px-1 py-px">
      <span className={cn("size-1 shrink-0 rounded-full", unread ? "bg-blue-500" : "bg-transparent")} />
      <span className={cn("size-2.5 shrink-0 rounded-[2px]", SENDER_COLORS[index % SENDER_COLORS.length])} />
      <Bar className="w-8 shrink-0 bg-foreground/50" />
      <Bar className="w-10 shrink-0 bg-foreground/50" />
      <FaintBar className="flex-1" />
      <FaintBar className="w-3 shrink-0" />
    </div>
  );
}

/** A message on two lines (the narrow list beside the reading pane). */
function NarrowMessageRow({ index, unread = false, selected = false }: { index: number; unread?: boolean; selected?: boolean }) {
  return (
    <div className={cn("flex shrink-0 items-center gap-1 rounded-[3px] px-1 py-[3px]", selected && "bg-blue-500/15")}>
      <span className={cn("size-1 shrink-0 rounded-full", unread ? "bg-blue-500" : "bg-transparent")} />
      <span className={cn("size-3 shrink-0 rounded-[2px]", SENDER_COLORS[index % SENDER_COLORS.length])} />
      <div className="min-w-0 flex-1 space-y-[3px]">
        <div className="flex items-center justify-between gap-1">
          <Bar className="w-1/2 bg-foreground/50" />
          <FaintBar className="w-3" />
        </div>
        <FaintBar className="w-4/5 bg-foreground/25" />
      </div>
    </div>
  );
}

function DateLabel() {
  return <FaintBar className="ml-1 mt-0.5 w-5 shrink-0" />;
}

/** The Smart view with its categories as rows (horizontal) or as cards across the top (vertical). */
export function CategoryLayoutPreview({ layout }: { layout: "horizontal" | "vertical" }) {
  return (
    <AppMock>
      {layout === "horizontal" ? (
        <>
          {[0, 1, 2, 3].map((i) => (
            <CategoryRow key={i} index={i} selected={i === 0} />
          ))}
        </>
      ) : (
        <div className="grid shrink-0 grid-cols-4 gap-1">
          {[0, 1, 2, 3].map((i) => (
            <CategoryCard key={i} index={i} selected={i === 0} />
          ))}
        </div>
      )}
      <DateLabel />
      {[0, 1, 2, 3, 4].map((i) => (
        <WideMessageRow key={i} index={i} unread={i % 2 === 0} />
      ))}
    </AppMock>
  );
}

/** Split view off: the list fills the window. On: a narrow list beside the conversation being read. */
export function SplitViewPreview({ split }: { split: boolean }) {
  if (!split) {
    return (
      <AppMock>
        {[0, 1, 2].map((i) => (
          <CategoryRow key={i} index={i} />
        ))}
        <DateLabel />
        {[0, 1, 2, 3, 4].map((i) => (
          <WideMessageRow key={i} index={i} unread={i % 2 === 0} />
        ))}
      </AppMock>
    );
  }
  return (
    <AppMock>
      <div className="flex min-h-0 flex-1 gap-1">
        <div className="flex w-[46%] shrink-0 flex-col gap-1 overflow-hidden">
          {[0, 1].map((i) => (
            <CategoryRow key={i} index={i} senders={1} />
          ))}
          <DateLabel />
          {[0, 1, 2, 3].map((i) => (
            <NarrowMessageRow key={i} index={i} unread={i !== 1} selected={i === 0} />
          ))}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5 rounded-[4px] border p-1.5">
          <div className="flex items-center justify-between">
            <span className="flex gap-0.5">
              {[0, 1, 2].map((i) => (
                <span key={i} className="size-1.5 rounded-[1px] bg-foreground/25" />
              ))}
            </span>
            <span className="flex gap-0.5">
              {[0, 1].map((i) => (
                <span key={i} className="size-1.5 rounded-[1px] bg-foreground/25" />
              ))}
            </span>
          </div>
          <Bar className="h-1.5 w-4/5 bg-foreground/60" />
          <FaintBar className="w-1/3" />
          <div className="space-y-1 rounded-[3px] border p-1">
            <div className="flex items-center gap-1">
              <span className="size-2 rounded-[2px] bg-foreground/15" />
              <FaintBar className="w-1/3" />
            </div>
            <FaintBar className="w-full" />
            <FaintBar className="w-full" />
            <FaintBar className="w-2/3" />
          </div>
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
