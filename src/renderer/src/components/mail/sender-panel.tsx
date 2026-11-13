import { useEffect, useMemo, useRef, useState } from "react";

import { ChevronRight, Network, Pin, Search, X } from "lucide-react";

import {
  groupSendersByDomain,
  type SenderDomainGroup,
  type SenderEntry,
} from "@shared/sender-list";
import type { Thread } from "@shared/threads";

import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { usePinnedDomains } from "@/hooks/use-pinned-domains";
import { cn } from "@/lib/utils";

import { SenderAvatar } from "./sender-avatar";

const ROW =
  "flex w-full cursor-default items-center gap-2.5 rounded-lg px-2 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

const DEFAULT_WIDTH = 288;
const MIN_WIDTH = 220;
const MAX_WIDTH = 520;
const WIDTH_KEY = "minimail.senderPanelWidth";

const clampWidth = (width: number) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(width)));

/** The width the user dragged the panel to last time; storage can be blocked, so it falls back. */
function loadWidth(): number {
  try {
    const saved = Number(window.localStorage.getItem(WIDTH_KEY));
    return saved > 0 ? clampWidth(saved) : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
}

function saveWidth(width: number): void {
  try {
    window.localStorage.setItem(WIDTH_KEY, String(width));
  } catch {
    // The width just won't be remembered.
  }
}

/** True when every word of the (lower-case) query is in the sender's name, address or domain. */
function matchesSender(sender: SenderEntry, needle: string): boolean {
  const haystack = `${sender.name} ${sender.email} ${sender.domain}`.toLowerCase();
  return needle.split(/\s+/).every((word) => haystack.includes(word));
}

function UnreadDot({ unread }: { unread: boolean }) {
  return (
    <span className="flex w-2 shrink-0 justify-center">
      {unread && <span className="size-2 rounded-full bg-unread" aria-label="Unread" />}
    </span>
  );
}

function SenderRow({
  sender,
  selected,
  nested = false,
  onSelect,
}: {
  sender: SenderEntry;
  selected: boolean;
  /** Listed under its domain. */
  nested?: boolean;
  onSelect: (key: string) => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      title={sender.email}
      className={cn(
        ROW,
        "h-12",
        nested && "pl-7",
        selected ? "bg-sidebar-primary/[0.12] dark:bg-sidebar-primary/25" : "hover:bg-accent/50",
      )}
      onClick={() => onSelect(sender.key)}
    >
      <UnreadDot unread={sender.unread} />
      <SenderAvatar contact={sender} size={28} logo={sender.logo} />
      <span className="min-w-0 flex-1 leading-tight">
        <span className={cn("block truncate", sender.unread ? "font-semibold" : "font-medium")}>
          {sender.name}
        </span>
        {sender.name !== sender.email && (
          <span className="block truncate text-xs text-muted-foreground">{sender.email}</span>
        )}
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">{sender.count}</span>
    </button>
  );
}

function DomainRow({
  group,
  open,
  selected,
  pinned,
  onSelect,
  onToggle,
  onTogglePin,
}: {
  group: SenderDomainGroup;
  open: boolean;
  /** Its mail is the list on screen. */
  selected: boolean;
  pinned: boolean;
  /** Lists all the mail of the domain, without expanding it. */
  onSelect: (domain: string) => void;
  /** Expands or collapses the domain (the chevron, or a double-click on the row). */
  onToggle: (domain: string) => void;
  onTogglePin: (domain: string) => void;
}) {
  return (
    <div className="group relative">
      <button
        type="button"
        aria-label={`${open ? "Collapse" : "Expand"} ${group.domain}`}
        aria-expanded={open}
        className="absolute left-1.5 top-1/2 z-10 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => onToggle(group.domain)}
      >
        <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
      </button>
      <button
        type="button"
        className={cn(
          ROW,
          "h-11 pl-9 pr-10",
          selected ? "bg-sidebar-primary/[0.12] dark:bg-sidebar-primary/25" : "hover:bg-accent/50",
        )}
        onClick={() => onSelect(group.domain)}
        onDoubleClick={() => onToggle(group.domain)}
      >
        <SenderAvatar
          contact={{ name: group.domain, email: group.domain }}
          size={24}
          logo={group.logo}
        />
        <span className="min-w-0 flex-1 truncate font-semibold">{group.domain}</span>
        {group.unread && <span className="size-2 shrink-0 rounded-full bg-unread" aria-label="Unread" />}
        <span className="shrink-0 text-xs text-muted-foreground">{group.count}</span>
      </button>
      <button
        type="button"
        aria-label={pinned ? `Unpin ${group.domain}` : `Pin ${group.domain}`}
        aria-pressed={pinned}
        title={pinned ? "Unpin domain" : "Pin domain"}
        className={cn(
          "absolute right-1.5 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md outline-none transition-opacity hover:bg-accent focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring",
          pinned
            ? "text-[hsl(var(--chart-3))]"
            : "text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100",
        )}
        onClick={() => onTogglePin(group.domain)}
      >
        <Pin className={cn("size-3.5", pinned && "fill-current")} />
      </button>
    </div>
  );
}

export interface SenderPanelState {
  /** Whether senders are gathered under their domain. */
  byDomain: boolean;
  setByDomain: (update: (on: boolean) => boolean) => void;
  /** The domains expanded in the grouped panel. */
  openDomains: ReadonlySet<string>;
  setOpenDomains: (update: ReadonlySet<string> | ((previous: ReadonlySet<string>) => ReadonlySet<string>)) => void;
  search: string;
  setSearch: (search: string) => void;
}

/**
 * The panel's state. It lives above the panel because the panel is rendered in two places (under
 * the list toolbar, or beside an open thread) and must not lose it when it moves. `active` is
 * whether the panel is on screen at all: coming on screen starts fresh with the selected sender's
 * domain open, and leaving drops the state.
 */
export function useSenderPanelState(
  senders: readonly SenderEntry[],
  selectedKey: string | null,
  active: boolean,
): SenderPanelState {
  const [byDomain, setByDomain] = useState(true);
  const [openDomains, setOpenDomains] = useState<ReadonlySet<string>>(new Set());
  const [search, setSearch] = useState("");
  const latest = useRef({ senders, selectedKey });
  latest.current = { senders, selectedKey };

  useEffect(() => {
    if (active) {
      // Grouped by default, so the selected sender's domain starts open to keep it in sight.
      const selected = latest.current.senders.find((s) => s.key === latest.current.selectedKey);
      setOpenDomains(new Set(selected ? [selected.domain] : []));
    } else {
      setByDomain(() => true);
      setOpenDomains(new Set());
      setSearch("");
    }
  }, [active]);

  return { byDomain, setByDomain, openDomains, setOpenDomains, search, setSearch };
}

interface SenderPanelProps {
  senders: readonly SenderEntry[];
  /** The conversations the senders come from, to count them per domain. */
  threads: readonly Thread[];
  /** Key of the sender whose mail is listed, if any. */
  selectedKey: string | null;
  /** The domain whose mail is listed, if any (only while grouped by domain). */
  selectedDomain: string | null;
  onSelect: (key: string) => void;
  /** Lists all the mail of a domain; null goes back to the selected sender. */
  onSelectDomain: (domain: string | null) => void;
  /** True while the folder's first load is running. */
  loading: boolean;
  /** The panel's own state, kept above it so it survives the panel moving (see the thread view). */
  state: SenderPanelState;
  /** True when the list's toolbar sits above the panel; false when the panel runs the full height. */
  underToolbar?: boolean;
}

/**
 * The Sender view's panel under the toolbar, left of the mail: every address the folder has mail
 * from, flat or gathered by domain. Picking one lists its mail next to the panel.
 */
export function SenderPanel({
  senders,
  threads,
  selectedKey,
  selectedDomain,
  onSelect,
  onSelectDomain,
  loading,
  state: { byDomain, setByDomain, openDomains, setOpenDomains, search, setSearch },
  underToolbar = true,
}: SenderPanelProps) {
  const { pinned, toggle: togglePin } = usePinnedDomains();
  const [width, setWidth] = useState(loadWidth);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);
  const needle = search.trim().toLowerCase();
  const searching = needle !== "";

  const shownSenders = useMemo(
    () => (searching ? senders.filter((sender) => matchesSender(sender, needle)) : senders),
    [senders, needle, searching],
  );
  const domains = useMemo(() => {
    if (!byDomain) return [];
    // Pinned domains come first; each half keeps the most recent order.
    const all = groupSendersByDomain(senders, threads);
    const groups = [
      ...all.filter((group) => pinned.has(group.domain)),
      ...all.filter((group) => !pinned.has(group.domain)),
    ];
    if (!searching) return groups;
    // A domain that matches keeps all its senders; otherwise only the senders that match stay.
    return groups.flatMap((group) => {
      if (group.domain.includes(needle)) return [group];
      const matching = group.senders.filter((sender) => matchesSender(sender, needle));
      return matching.length > 0 ? [{ ...group, senders: matching }] : [];
    });
  }, [byDomain, senders, threads, pinned, needle, searching]);

  const toggleByDomain = () => {
    // Start with the selected sender's domain open, so the selection stays in sight.
    const selected = senders.find((sender) => sender.key === selectedKey);
    setOpenDomains(new Set(selected ? [selected.domain] : []));
    // Domains only exist in the grouped panel, so leaving it drops a picked domain.
    if (byDomain) onSelectDomain(null);
    setByDomain((on) => !on);
  };

  const toggleDomain = (domain: string) => {
    setOpenDomains((previous) => {
      const next = new Set(previous);
      if (next.has(domain)) next.delete(domain);
      else next.add(domain);
      return next;
    });
  };

  return (
    <aside
      aria-label="Senders"
      style={{ width }}
      className="relative flex shrink-0 flex-col border-r border-border"
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize senders panel"
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={MAX_WIDTH}
        aria-valuenow={width}
        tabIndex={0}
        className={cn(
          "absolute inset-y-0 -right-1 z-20 w-2 cursor-col-resize touch-none outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-0.5 after:-translate-x-1/2 after:rounded-full after:transition-colors hover:after:bg-sidebar-primary/60 focus-visible:after:bg-sidebar-primary/60",
          dragging && "after:bg-sidebar-primary/60",
        )}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { startX: event.clientX, startWidth: width };
          setDragging(true);
        }}
        onPointerMove={(event) => {
          if (!drag.current) return;
          setWidth(clampWidth(drag.current.startWidth + event.clientX - drag.current.startX));
        }}
        onPointerUp={() => {
          drag.current = null;
          setDragging(false);
          saveWidth(width);
        }}
        onPointerCancel={() => {
          drag.current = null;
          setDragging(false);
        }}
        onDoubleClick={() => {
          setWidth(DEFAULT_WIDTH);
          saveWidth(DEFAULT_WIDTH);
        }}
        onKeyDown={(event) => {
          const step = event.key === "ArrowLeft" ? -16 : event.key === "ArrowRight" ? 16 : 0;
          if (step === 0) return;
          event.preventDefault();
          const next = clampWidth(width + step);
          setWidth(next);
          saveWidth(next);
        }}
      />
      {/* Beside the thread there is no toolbar above, so the search row sits at the toolbar's height. */}
      <div className={cn("mx-3 mb-2 flex shrink-0 items-center gap-2", underToolbar ? "mt-1" : "mt-10")}>
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            placeholder="Search senders or domains"
            aria-label="Search senders or domains"
            className="h-9 pl-8 pr-8"
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && search) {
                event.stopPropagation();
                setSearch("");
              }
            }}
          />
          {search && (
            <button
              type="button"
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => setSearch("")}
            >
              <X className="size-4" />
            </button>
          )}
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Group by domain"
              aria-pressed={byDomain}
              onClick={toggleByDomain}
              className={cn(
                "corner-squircle flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors",
                byDomain
                  ? "bg-muted text-foreground hover:bg-accent"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <Network className="size-[18px]" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {byDomain ? "Stop grouping by domain" : "Group by domain"}
          </TooltipContent>
        </Tooltip>
      </div>

      <div role="listbox" aria-label="Senders" className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-6">
        {loading &&
          Array.from({ length: 8 }, (_, index) => (
            <div key={index} className="flex h-12 items-center gap-2.5 px-2" aria-hidden>
              <span className="w-2" />
              <Skeleton className="size-7 rounded-lg" />
              <Skeleton className="h-4 flex-1" style={{ maxWidth: `${80 - (index % 3) * 15}%` }} />
            </div>
          ))}

        {!loading && shownSenders.length === 0 && (
          <p className="px-3 pt-6 text-center text-sm text-muted-foreground">
            {searching ? `No sender or domain matches “${search.trim()}”.` : "No senders here."}
          </p>
        )}

        {byDomain
          ? domains.map((group) => {
              // While searching, every domain that matched shows what matched inside it.
              const open = searching || openDomains.has(group.domain);
              return (
                <div key={group.domain} role="group" aria-label={group.domain} className="space-y-0.5">
                  <DomainRow
                    group={group}
                    open={open}
                    selected={group.domain === selectedDomain}
                    pinned={pinned.has(group.domain)}
                    onSelect={onSelectDomain}
                    onToggle={toggleDomain}
                    onTogglePin={togglePin}
                  />
                  {open &&
                    group.senders.map((sender) => (
                      <SenderRow
                        key={sender.key}
                        sender={sender}
                        selected={sender.key === selectedKey}
                        nested
                        onSelect={onSelect}
                      />
                    ))}
                </div>
              );
            })
          : shownSenders.map((sender) => (
              <SenderRow
                key={sender.key}
                sender={sender}
                selected={sender.key === selectedKey}
                onSelect={onSelect}
              />
            ))}
      </div>
    </aside>
  );
}

/** Names the sender whose mail the list under it shows. */
export function SenderHeading(
  props: { sender: SenderEntry } | { domain: string; count: number },
) {
  if ("domain" in props) {
    return (
      <div className="flex shrink-0 items-center gap-2.5 px-6 pb-1 pt-1">
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate font-semibold">{props.domain}</div>
          <div className="truncate text-xs text-muted-foreground">
            All senders · {props.count} {props.count === 1 ? "conversation" : "conversations"}
          </div>
        </div>
      </div>
    );
  }
  const { sender } = props;
  return (
    <div className="flex shrink-0 items-center gap-2.5 px-6 pb-1 pt-1">
      <SenderAvatar contact={sender} size={28} logo={sender.logo} />
      <div className="min-w-0 flex-1 leading-tight">
        <div className="truncate text-[13px] font-semibold">{sender.name}</div>
        <div className="truncate text-xs text-muted-foreground">
          {sender.name !== sender.email ? `${sender.email} · ` : ""}
          {sender.count} {sender.count === 1 ? "conversation" : "conversations"}
        </div>
      </div>
    </div>
  );
}
