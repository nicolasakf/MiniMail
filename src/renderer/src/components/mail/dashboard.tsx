import { useMemo, useState } from "react";

import { ArrowLeft, AtSign, Bot, CornerUpLeft, MailWarning, Paperclip, RefreshCw, UserRound } from "lucide-react";

import { accountLabel } from "@shared/accounts";
import {
  buildDashboardStats,
  DASHBOARD_RANGES,
  receivedMail,
  type DashboardDrill,
  type DashboardFilter,
  type DashboardFlag,
  type DashboardRange,
  type TimeBucket,
  type TimeUnit,
} from "@shared/dashboard";
import { MAIL_WINDOW } from "@shared/mail-window";
import type { MoveFolder } from "@shared/threads";
import type { Account, AccountError, Category, MessageSummary } from "@shared/types";

import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import { AccountMark } from "./account-mark";
import { CategoryIcon } from "./category-icon";
import {
  ACCENT,
  BarList,
  ChartCard,
  ColumnChart,
  Donut,
  formatCount,
  formatPercent,
  Heatmap,
  hourLabel,
  Meter,
  SegmentedBar,
  StatTile,
  TooltipLayer,
  weekdayName,
  type BarRow,
  type Column,
  type Slice,
} from "./dashboard-charts";
import { SenderAvatar } from "./sender-avatar";

/** What a click on the Dashboard opens: the matching mail, and how to title that list. */
export interface DashboardSelection extends DashboardDrill {
  title: string;
  subtitle: string;
}

const RANGE_LABELS: Record<DashboardRange, string> = {
  today: "Today",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  all: "All loaded mail",
};

const FLAG_LABELS: Record<DashboardFlag, string> = {
  unread: "Unread",
  attachments: "With attachments",
  answered: "Replied to",
  people: "From people",
  automated: "Automated & bulk",
};

/** Volume chart series: read in the regular blue, unread in amber. */
const UNREAD_COLOR = "hsl(var(--chart-unread))";
const READ_COLOR = ACCENT;

const TOP_SHOWN = 8;
const TOP_EXPANDED = 20;
const OPEN_HINT = "Click to see these messages";

const monthLong = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
const monthShort = new Intl.DateTimeFormat(undefined, { month: "short" });
const dayShort = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const dayLong = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "short", day: "numeric" });
const weekdayShort = new Intl.DateTimeFormat(undefined, { weekday: "short" });

function bucketTitle(bucket: TimeBucket, unit: TimeUnit): string {
  const start = new Date(bucket.start);
  if (unit === "hour") return `Today, ${hourLabel(start.getHours())}–${hourLabel((start.getHours() + 1) % 24)}`;
  if (unit === "day") return dayLong.format(start);
  return monthLong.format(start);
}

function bucketAxis(bucket: TimeBucket, unit: TimeUnit, count: number): string {
  const start = new Date(bucket.start);
  if (unit === "hour") return hourLabel(start.getHours());
  if (unit === "day") return count <= 7 ? weekdayShort.format(start) : dayShort.format(start);
  return monthShort.format(start);
}

const TIMELINE_SUBTITLE: Record<DashboardRange, string> = {
  today: "Messages per hour, today",
  "7d": "Messages per day, last 7 days",
  "30d": "Messages per day, last 30 days",
  all: "Messages per month",
};

/** The color of a category everywhere on the Dashboard: its own hue, gray for none. */
function categoryColor(category: Category | undefined): string {
  return category ? `hsl(${category.hue} 70% 55%)` : "hsl(var(--muted-foreground) / 0.45)";
}

interface DashboardProps {
  messages: readonly MessageSummary[];
  accounts: readonly Account[];
  categories: readonly Category[];
  loading: boolean;
  errors: readonly AccountError[];
  range: DashboardRange;
  onRangeChange: (range: DashboardRange) => void;
  onOpen: (selection: DashboardSelection) => void;
  onRefresh: () => void;
}

/** Statistics about received mail; every sender, domain, category, bar and cell opens its mail. */
export function Dashboard({
  messages,
  accounts,
  categories,
  loading,
  errors,
  range,
  onRangeChange,
  onOpen,
  onRefresh,
}: DashboardProps) {
  const [moreSenders, setMoreSenders] = useState(false);
  const [moreDomains, setMoreDomains] = useState(false);

  const received = useMemo(
    () => receivedMail(messages, accounts.map((account) => account.email)),
    [messages, accounts],
  );
  // "Today" moves on with each refresh of the data.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => Date.now(), [received, range]);
  const stats = useMemo(() => buildDashboardStats(received, range, now), [received, range, now]);
  const categoryById = useMemo(() => new Map(categories.map((category) => [category.id, category])), [categories]);
  const accountById = useMemo(() => new Map(accounts.map((account) => [account.id, account])), [accounts]);

  const rangeLabel = RANGE_LABELS[range];
  const open = (filter: DashboardFilter, title: string, subtitle = rangeLabel, inRange = range) =>
    onOpen({ filter, range: inRange, title, subtitle });

  const categoryName = (id: string | null) =>
    id === null ? "No category" : (categoryById.get(id)?.name ?? "Removed category");

  const columns: Column[] = stats.timeline.map((bucket) => {
    const title = bucketTitle(bucket, stats.timeUnit);
    const pick = (unread?: boolean) => () =>
      open(
        { kind: "time", start: bucket.start, end: bucket.end, unread },
        unread === undefined ? title : `${title} · ${unread ? "unread" : "read"}`,
        "Mail volume",
      );
    return {
      key: String(bucket.start),
      title,
      // Unread sits on the baseline: it is the part worth comparing from bucket to bucket.
      segments: [
        { key: "unread", label: "Unread", value: bucket.unread, color: UNREAD_COLOR, onPick: pick(true) },
        { key: "read", label: "Read", value: bucket.count - bucket.unread, color: READ_COLOR, onPick: pick(false) },
      ],
      axisLabel: bucketAxis(bucket, stats.timeUnit, stats.timeline.length),
      onPick: pick(),
    };
  });

  const senderRows: BarRow[] = stats.senders.slice(0, moreSenders ? TOP_EXPANDED : TOP_SHOWN).map((sender) => ({
    key: sender.key,
    label: sender.name,
    sublabel: sender.name.toLowerCase() === sender.key ? undefined : sender.email,
    value: sender.count,
    leading: <SenderAvatar contact={{ name: sender.name, email: sender.email }} size={20} logo={sender.logo} />,
    tip: {
      title: sender.name,
      rows: [
        { label: "Messages", value: formatCount(sender.count) },
        { label: "Unread", value: formatCount(sender.unread) },
        { label: "Share", value: formatPercent(sender.count, stats.total) },
      ],
      hint: OPEN_HINT,
    },
    onPick: () =>
      open({ kind: "sender", email: sender.email, name: sender.name }, sender.name, `${sender.email} · ${rangeLabel}`),
  }));

  const domainRows: BarRow[] = stats.domains.slice(0, moreDomains ? TOP_EXPANDED : TOP_SHOWN).map((domain) => ({
    key: domain.domain,
    label: domain.domain,
    sublabel: domain.senders > 1 ? `${domain.senders} senders` : undefined,
    value: domain.count,
    leading: (
      <SenderAvatar contact={{ name: domain.domain, email: `@${domain.domain}` }} size={20} logo={domain.logo} />
    ),
    tip: {
      title: domain.domain,
      rows: [
        { label: "Messages", value: formatCount(domain.count) },
        { label: "Senders", value: formatCount(domain.senders) },
        { label: "Unread", value: formatCount(domain.unread) },
        { label: "Share", value: formatPercent(domain.count, stats.total) },
      ],
      hint: OPEN_HINT,
    },
    onPick: () => open({ kind: "domain", domain: domain.domain }, domain.domain),
  }));

  const categorySlices: Slice[] = stats.categories.map((entry) => {
    const category = entry.categoryId === null ? undefined : categoryById.get(entry.categoryId);
    const name = categoryName(entry.categoryId);
    return {
      key: entry.categoryId ?? "none",
      label: name,
      value: entry.count,
      color: categoryColor(category),
      leading: category ? (
        <CategoryIcon icon={category.icon} className="size-3.5 shrink-0 text-muted-foreground" />
      ) : undefined,
      hint: `${entry.unread} unread · ${OPEN_HINT.toLowerCase()}`,
      onPick: () => open({ kind: "category", categoryId: entry.categoryId }, name),
    };
  });

  const accountSlices: Slice[] = stats.accounts.map((entry) => {
    const account = accountById.get(entry.accountId);
    const label = account ? accountLabel(account) : "Removed account";
    return {
      key: entry.accountId,
      label,
      value: entry.count,
      color: account ? `hsl(${account.hue} 70% 55%)` : "hsl(var(--muted-foreground) / 0.45)",
      leading: account ? <AccountMark account={account} size={16} /> : undefined,
      hint: OPEN_HINT,
      onPick: () => open({ kind: "account", accountId: entry.accountId }, label),
    };
  });

  const flag = (name: DashboardFlag) => () => open({ kind: "flag", flag: name }, FLAG_LABELS[name]);

  const busiest =
    stats.busiestHour && stats.busiestWeekday
      ? `Busiest: ${weekdayName(stats.busiestWeekday.weekday, true)}s, around ${hourLabel(stats.busiestHour.hour)}`
      : "No mail in this period";

  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const firstLoad = loading && messages.length === 0;

  return (
    <TooltipLayer>
      <header className="electron-window-drag flex h-[88px] shrink-0 items-end justify-between gap-4 px-8 pb-3 pt-10">
        <div className="electron-no-drag -ml-2 flex min-w-0 items-center gap-4 px-2">
          <h1 className="shrink-0 text-base font-semibold">Dashboard</h1>
          <Tabs value={range} onValueChange={(next) => onRangeChange(next as DashboardRange)}>
            <TabsList aria-label="Period" className="h-9 shrink-0">
              {DASHBOARD_RANGES.map((option) => (
                <TabsTrigger key={option.range} value={option.range} className="h-7 py-0">
                  {option.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
        <div className="electron-no-drag flex min-w-0 items-center gap-3">
          <span className="hidden truncate text-xs text-muted-foreground lg:inline">
            {formatCount(received.length)} messages from Inbox, Archive, Spam and Trash
            {errors.length > 0 && ` · ${errors.length} account${errors.length > 1 ? "s" : ""} not reached`}
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Refresh"
                onClick={onRefresh}
                className="corner-squircle flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <RefreshCw className={loading ? "size-[18px] animate-spin" : "size-[18px]"} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              Refresh · the newest {MAIL_WINDOW} messages per account in each folder, the same mail the folders list
            </TooltipContent>
          </Tooltip>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-10 pt-2">
        {firstLoad ? (
          <DashboardSkeleton />
        ) : (
          <div className="mx-auto grid max-w-[1400px] grid-cols-12 gap-4">
            <div className="col-span-12 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatTile
                label="Received today"
                value={formatCount(stats.today)}
                delta={{ value: stats.today - stats.yesterday, label: "vs yesterday" }}
                spark={stats.todayByHour.slice(0, new Date(now).getHours() + 1)}
                sparkLabel="Messages per hour today"
                hint="See today's mail"
                onClick={() =>
                  open(
                    { kind: "time", start: startOfToday.getTime(), end: Number.POSITIVE_INFINITY },
                    "Received today",
                    dayLong.format(startOfToday),
                  )
                }
              />
              <StatTile
                label="Last 7 days"
                value={formatCount(stats.last7)}
                delta={{ value: stats.last7 - stats.previous7, label: "vs the week before" }}
                spark={stats.last14Days}
                sparkLabel="Messages per day, last 14 days"
                hint="See the last 7 days"
                onClick={() => open({ kind: "all" }, "Last 7 days", "All received mail", "7d")}
              />
              <StatTile
                label={`Unread · ${rangeLabel.toLowerCase()}`}
                value={formatCount(stats.unread)}
                detail={`${formatPercent(stats.unread, stats.total)} of ${formatCount(stats.total)} received`}
                hint="See unread mail"
                onClick={stats.unread > 0 ? flag("unread") : undefined}
              />
              <StatTile
                label="Daily average · 30 days"
                value={stats.dailyAverage30 >= 10 ? formatCount(stats.dailyAverage30) : stats.dailyAverage30.toFixed(1)}
                detail={busiest}
              />
            </div>

            <ChartCard
              title="Mail volume"
              subtitle={TIMELINE_SUBTITLE[range]}
              className="col-span-12 xl:col-span-8"
              action={<span className="text-xs tabular-nums text-muted-foreground">{formatCount(stats.total)} total</span>}
            >
              <ColumnChart
                columns={columns}
                ariaLabel={TIMELINE_SUBTITLE[range]}
                legend={[
                  { label: "Unread", color: UNREAD_COLOR },
                  { label: "Read", color: READ_COLOR },
                ]}
              />
            </ChartCard>

            <ChartCard title="By category" subtitle={rangeLabel} className="col-span-12 xl:col-span-4">
              {categorySlices.length === 0 ? (
                <EmptyChart />
              ) : (
                <Donut slices={categorySlices} totalLabel="messages" />
              )}
            </ChartCard>

            <ChartCard
              title="Top senders"
              subtitle={`${formatCount(stats.senders.length)} people and services · ${rangeLabel.toLowerCase()}`}
              className="col-span-12 lg:col-span-6"
              action={
                stats.senders.length > TOP_SHOWN && (
                  <ShowMore expanded={moreSenders} onToggle={() => setMoreSenders((value) => !value)} />
                )
              }
            >
              <BarList rows={senderRows} empty="No mail in this period" />
            </ChartCard>

            <ChartCard
              title="Top domains"
              subtitle={`${formatCount(stats.domains.length)} domains · ${rangeLabel.toLowerCase()}`}
              className="col-span-12 lg:col-span-6"
              action={
                stats.domains.length > TOP_SHOWN && (
                  <ShowMore expanded={moreDomains} onToggle={() => setMoreDomains((value) => !value)} />
                )
              }
            >
              <BarList rows={domainRows} empty="No mail in this period" />
            </ChartCard>

            <ChartCard
              title="When mail arrives"
              subtitle={`Messages by weekday and hour · ${rangeLabel.toLowerCase()}`}
              className="col-span-12 xl:col-span-8"
            >
              <Heatmap
                grid={stats.heatmap}
                max={stats.heatmapMax}
                onPick={(weekday, hour) =>
                  open({ kind: "slot", weekday, hour }, `${weekdayName(weekday, true)}s, ${hourLabel(hour)}`)
                }
              />
            </ChartCard>

            <ChartCard title="Mail mix" subtitle={rangeLabel} className="col-span-12 xl:col-span-4">
              <div className="flex flex-col">
                <Meter label="From people" icon={<UserRound className="size-4" />} value={stats.people} total={stats.total} onPick={flag("people")} hint={OPEN_HINT} />
                <Meter label="Automated & bulk" icon={<Bot className="size-4" />} value={stats.automated} total={stats.total} onPick={flag("automated")} hint={OPEN_HINT} />
                <Meter label="Unread" icon={<MailWarning className="size-4" />} value={stats.unread} total={stats.total} onPick={flag("unread")} hint={OPEN_HINT} />
                <Meter label="With attachments" icon={<Paperclip className="size-4" />} value={stats.withAttachments} total={stats.total} onPick={flag("attachments")} hint={OPEN_HINT} />
                <Meter label="Replied to" icon={<CornerUpLeft className="size-4" />} value={stats.answered} total={stats.total} onPick={flag("answered")} hint={OPEN_HINT} />
              </div>
            </ChartCard>

            {accounts.length > 1 && (
              <ChartCard
                title="By account"
                subtitle={rangeLabel}
                className="col-span-12"
                action={<AtSign className="size-4 text-muted-foreground" />}
              >
                {accountSlices.length === 0 ? <EmptyChart /> : <SegmentedBar slices={accountSlices} />}
              </ChartCard>
            )}
          </div>
        )}
      </div>
    </TooltipLayer>
  );
}

function ShowMore({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      {expanded ? "Show fewer" : "Show more"}
    </button>
  );
}

function EmptyChart() {
  return <p className="py-10 text-center text-sm text-muted-foreground">No mail in this period</p>;
}

function DashboardSkeleton() {
  return (
    <div className="mx-auto grid max-w-[1400px] grid-cols-12 gap-4" aria-busy="true" aria-label="Loading statistics">
      {Array.from({ length: 4 }, (_, index) => (
        <Skeleton key={index} className="col-span-12 h-[92px] rounded-xl sm:col-span-6 xl:col-span-3" />
      ))}
      <Skeleton className="col-span-12 h-[290px] rounded-xl xl:col-span-8" />
      <Skeleton className="col-span-12 h-[290px] rounded-xl xl:col-span-4" />
      <Skeleton className="col-span-12 h-[320px] rounded-xl lg:col-span-6" />
      <Skeleton className="col-span-12 h-[320px] rounded-xl lg:col-span-6" />
    </div>
  );
}

/** Above the mail a Dashboard click opened: the way back, what was picked, and how much matched. */
/** Which folder a Dashboard list shows: every one, or a single folder. */
export type DrillFolder = "all" | MoveFolder;

const DRILL_FOLDERS: readonly { folder: DrillFolder; label: string }[] = [
  { folder: "all", label: "All" },
  { folder: "inbox", label: "Inbox" },
  { folder: "archive", label: "Archive" },
  { folder: "trash", label: "Trash" },
  { folder: "spam", label: "Spam" },
];

export function DashboardDrillHeader({
  selection,
  count,
  onBack,
  folder,
  onFolderChange,
  folderCounts,
}: {
  selection: DashboardSelection;
  /** Messages shown, in the chosen folder. */
  count: number;
  onBack: () => void;
  folder: DrillFolder;
  onFolderChange: (folder: DrillFolder) => void;
  /** Matching messages per folder tab, "all" included. */
  folderCounts: Readonly<Record<DrillFolder, number>>;
}) {
  return (
    <header className="electron-window-drag flex h-[88px] shrink-0 items-end gap-3 px-6 pb-3 pt-10">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="Back to Dashboard"
            onClick={onBack}
            className="corner-squircle electron-no-drag flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <ArrowLeft className="size-[18px]" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          Back to Dashboard <span className="ml-2 text-muted-foreground">Esc</span>
        </TooltipContent>
      </Tooltip>
      <div className="electron-no-drag min-w-0">
        <div className="text-[11px] text-muted-foreground">Dashboard</div>
        <h1 className="flex min-w-0 items-baseline gap-2 text-base font-semibold">
          <span className="truncate">{selection.title}</span>
          <span className="shrink-0 text-xs font-normal text-muted-foreground">
            {formatCount(count)} message{count === 1 ? "" : "s"} · {selection.subtitle}
          </span>
        </h1>
      </div>
      <Tabs
        value={folder}
        onValueChange={(next) => onFolderChange(next as DrillFolder)}
        className="electron-no-drag ml-auto shrink-0"
      >
        <TabsList aria-label="Folder" className="h-9">
          {DRILL_FOLDERS.map((option) => (
            <TabsTrigger key={option.folder} value={option.folder} className="h-7 gap-1.5 py-0">
              {option.label}
              <span className="text-[11px] font-normal tabular-nums opacity-60">
                {formatCount(folderCounts[option.folder])}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </header>
  );
}
