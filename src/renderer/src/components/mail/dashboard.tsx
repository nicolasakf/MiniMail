import { useMemo, useState } from "react";

import {
  AtSign,
  Bot,
  CornerUpLeft,
  MailWarning,
  Paperclip,
  UserRound,
} from "lucide-react";

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
import type {
  Account,
  AccountError,
  Category,
  MessageSummary,
  ShownFolder,
} from "@shared/types";

import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SHOWN_FOLDERS, type AccountScope } from "@/hooks/use-mailbox";

import { AccountMark } from "./account-mark";
import { CategoryIcon } from "./category-icon";
import {
  AccountSwitcher,
  FolderFilterGroup,
  RefreshButton,
} from "./list-header";
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
  type LegendEntry,
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
/** The mail mix series: mail from people in the regular blue, automated and bulk mail in gray. */
const PEOPLE_COLOR = ACCENT;
const AUTOMATED_COLOR = "hsl(var(--muted-foreground) / 0.45)";

/** What the stacked bars of the volume chart are split by. */
export type VolumeGrouping = "read" | "category" | "mix";

const VOLUME_GROUPINGS: readonly { grouping: VolumeGrouping; label: string }[] = [
  { grouping: "read", label: "Read" },
  { grouping: "category", label: "Category" },
  { grouping: "mix", label: "Mail mix" },
];

const TOP_SHOWN = 8;
const TOP_EXPANDED = 20;
const OPEN_HINT = "Click to see these messages";

const monthLong = new Intl.DateTimeFormat(undefined, {
  month: "long",
  year: "numeric",
});
const monthShort = new Intl.DateTimeFormat(undefined, { month: "short" });
const dayShort = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});
const dayLong = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "short",
  day: "numeric",
});
const weekdayShort = new Intl.DateTimeFormat(undefined, { weekday: "short" });

function bucketTitle(bucket: TimeBucket, unit: TimeUnit): string {
  const start = new Date(bucket.start);
  if (unit === "hour")
    return `Today, ${hourLabel(start.getHours())}–${hourLabel((start.getHours() + 1) % 24)}`;
  if (unit === "day") return dayLong.format(start);
  return monthLong.format(start);
}

function bucketAxis(bucket: TimeBucket, unit: TimeUnit, count: number): string {
  const start = new Date(bucket.start);
  if (unit === "hour") return hourLabel(start.getHours());
  if (unit === "day")
    return count <= 7 ? weekdayShort.format(start) : dayShort.format(start);
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
  return category
    ? `hsl(${category.hue} 70% 55%)`
    : "hsl(var(--muted-foreground) / 0.45)";
}

interface DashboardProps {
  messages: readonly MessageSummary[];
  accounts: readonly Account[];
  categories: readonly Category[];
  loading: boolean;
  errors: readonly AccountError[];
  /** Which account the charts count: one, or all of them. */
  scope: AccountScope;
  onScopeChange: (scope: AccountScope) => void;
  onManageAccounts: () => void;
  range: DashboardRange;
  onRangeChange: (range: DashboardRange) => void;
  /** What the volume chart's bars are split by; kept by the parent so it survives opening a list. */
  volumeBy: VolumeGrouping;
  onVolumeByChange: (grouping: VolumeGrouping) => void;
  onOpen: (selection: DashboardSelection) => void;
  onRefresh: () => void;
  /** The folders whose mail the statistics count. */
  shownFolders: readonly ShownFolder[];
  onToggleFolder: (folder: ShownFolder) => void;
}

/** Statistics about received mail; every sender, domain, category, bar and cell opens its mail. */
export function Dashboard({
  messages,
  accounts,
  categories,
  loading,
  errors,
  scope,
  onScopeChange,
  onManageAccounts,
  range,
  onRangeChange,
  volumeBy,
  onVolumeByChange,
  onOpen,
  onRefresh,
  shownFolders,
  onToggleFolder,
}: DashboardProps) {
  const [moreSenders, setMoreSenders] = useState(false);
  const [moreDomains, setMoreDomains] = useState(false);

  const received = useMemo(
    () =>
      receivedMail(
        messages.filter(
          (message) =>
            (scope === "all" || message.accountId === scope) &&
            (!SHOWN_FOLDERS.includes(message.folder as ShownFolder) ||
              shownFolders.includes(message.folder as ShownFolder)),
        ),
        accounts.map((account) => account.email),
      ),
    [messages, accounts, shownFolders, scope],
  );
  // "Today" moves on with each refresh of the data.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => Date.now(), [received, range]);
  const stats = useMemo(
    () => buildDashboardStats(received, range, now),
    [received, range, now],
  );
  const categoryById = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories],
  );
  const accountById = useMemo(
    () => new Map(accounts.map((account) => [account.id, account])),
    [accounts],
  );

  const rangeLabel = RANGE_LABELS[range];
  const open = (
    filter: DashboardFilter,
    title: string,
    subtitle = rangeLabel,
    inRange = range,
  ) => onOpen({ filter, range: inRange, title, subtitle });

  const categoryName = (id: string | null) =>
    id === null
      ? "No category"
      : (categoryById.get(id)?.name ?? "Removed category");

  const categoryEntries = stats.categories.map((entry) => {
    const category =
      entry.categoryId === null
        ? undefined
        : categoryById.get(entry.categoryId);
    return {
      id: entry.categoryId,
      name: categoryName(entry.categoryId),
      color: categoryColor(category),
    };
  });

  const volumeLegend: LegendEntry[] =
    volumeBy === "read"
      ? [
          { label: "Unread", color: UNREAD_COLOR },
          { label: "Read", color: READ_COLOR },
        ]
      : volumeBy === "mix"
        ? [
            { label: "From people", color: PEOPLE_COLOR },
            { label: "Automated & bulk", color: AUTOMATED_COLOR },
          ]
        : categoryEntries.map((entry) => ({
            label: entry.name,
            color: entry.color,
          }));

  const columns: Column[] = stats.timeline.map((bucket) => {
    const title = bucketTitle(bucket, stats.timeUnit);
    const range = { start: bucket.start, end: bucket.end };
    const pick = (
      part?: { unread?: boolean; categoryId?: string | null; people?: boolean },
      partName?: string,
    ) => () =>
      open(
        { kind: "time", ...range, ...part },
        partName === undefined ? title : `${title} · ${partName}`,
        "Mail volume",
      );
    // The first segment sits on the baseline: with unread first it is the part worth comparing
    // from bucket to bucket; by category, the biggest category.
    const segments: Column["segments"] =
      volumeBy === "read"
        ? [
            {
              key: "unread",
              label: "Unread",
              value: bucket.unread,
              color: UNREAD_COLOR,
              onPick: pick({ unread: true }, "unread"),
            },
            {
              key: "read",
              label: "Read",
              value: bucket.count - bucket.unread,
              color: READ_COLOR,
              onPick: pick({ unread: false }, "read"),
            },
          ]
        : volumeBy === "mix"
          ? [
              {
                key: "people",
                label: "From people",
                value: bucket.people,
                color: PEOPLE_COLOR,
                onPick: pick({ people: true }, "from people"),
              },
              {
                key: "automated",
                label: "Automated & bulk",
                value: bucket.count - bucket.people,
                color: AUTOMATED_COLOR,
                onPick: pick({ people: false }, "automated & bulk"),
              },
            ]
          : categoryEntries.map((entry) => ({
              key: entry.id ?? "none",
              label: entry.name,
              value: bucket.categories.get(entry.id) ?? 0,
              color: entry.color,
              onPick: pick({ categoryId: entry.id }, entry.name),
            }));
    return {
      key: String(bucket.start),
      title,
      segments,
      axisLabel: bucketAxis(bucket, stats.timeUnit, stats.timeline.length),
      onPick: pick(),
    };
  });

  const senderRows: BarRow[] = stats.senders
    .slice(0, moreSenders ? TOP_EXPANDED : TOP_SHOWN)
    .map((sender) => ({
      key: sender.key,
      label: sender.name,
      sublabel:
        sender.name.toLowerCase() === sender.key ? undefined : sender.email,
      value: sender.count,
      leading: (
        <SenderAvatar
          contact={{ name: sender.name, email: sender.email }}
          size={20}
          logo={sender.logo}
        />
      ),
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
        open(
          { kind: "sender", email: sender.email, name: sender.name },
          sender.name,
          `${sender.email} · ${rangeLabel}`,
        ),
    }));

  const domainRows: BarRow[] = stats.domains
    .slice(0, moreDomains ? TOP_EXPANDED : TOP_SHOWN)
    .map((domain) => ({
      key: domain.domain,
      label: domain.domain,
      sublabel: domain.senders > 1 ? `${domain.senders} senders` : undefined,
      value: domain.count,
      leading: (
        <SenderAvatar
          contact={{ name: domain.domain, email: `@${domain.domain}` }}
          size={20}
          logo={domain.logo}
        />
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
      onPick: () =>
        open({ kind: "domain", domain: domain.domain }, domain.domain),
    }));

  const categorySlices: Slice[] = stats.categories.map((entry) => {
    const category =
      entry.categoryId === null
        ? undefined
        : categoryById.get(entry.categoryId);
    const name = categoryName(entry.categoryId);
    return {
      key: entry.categoryId ?? "none",
      label: name,
      value: entry.count,
      color: categoryColor(category),
      leading: category ? (
        <CategoryIcon
          icon={category.icon}
          className="size-3.5 shrink-0 text-muted-foreground"
        />
      ) : undefined,
      hint: `${entry.unread} unread · ${OPEN_HINT.toLowerCase()}`,
      onPick: () =>
        open({ kind: "category", categoryId: entry.categoryId }, name),
    };
  });

  const accountSlices: Slice[] = stats.accounts.map((entry) => {
    const account = accountById.get(entry.accountId);
    const label = account ? accountLabel(account) : "Removed account";
    return {
      key: entry.accountId,
      label,
      value: entry.count,
      color: account
        ? `hsl(${account.hue} 70% 55%)`
        : "hsl(var(--muted-foreground) / 0.45)",
      leading: account ? (
        <AccountMark account={account} size={16} />
      ) : undefined,
      hint: OPEN_HINT,
      onPick: () =>
        open({ kind: "account", accountId: entry.accountId }, label),
    };
  });

  const flag = (name: DashboardFlag) => () =>
    open({ kind: "flag", flag: name }, FLAG_LABELS[name]);

  const busiest =
    stats.busiestHour && stats.busiestWeekday
      ? `Busiest: ${weekdayName(stats.busiestWeekday.weekday, true)}s, around ${hourLabel(stats.busiestHour.hour)}`
      : "No mail in this period";

  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const firstLoad = loading && messages.length === 0;

  return (
    <TooltipLayer>
      <header className="electron-window-drag flex h-16 shrink-0 items-end justify-between gap-4 px-8 pb-3 pt-3">
        <div className="electron-no-drag -ml-2 flex min-w-0 items-center gap-4 px-2">
          <h1 className="shrink-0 text-base font-semibold">Dashboard</h1>
          <AccountSwitcher
            accounts={accounts}
            scope={scope}
            onScopeChange={onScopeChange}
            onManageAccounts={onManageAccounts}
          />
          <RefreshButton
            className="-mx-2"
            onRefresh={onRefresh}
            refreshing={loading}
          />
          <Tabs
            value={range}
            onValueChange={(next) => onRangeChange(next as DashboardRange)}
          >
            <TabsList aria-label="Period" className="h-9 shrink-0">
              {DASHBOARD_RANGES.map((option) => (
                <TabsTrigger
                  key={option.range}
                  value={option.range}
                  className="h-7 py-0"
                >
                  {option.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
        <div className="electron-no-drag flex min-w-0 items-center gap-3">
          <span className="hidden truncate text-xs text-muted-foreground lg:inline">
            {formatCount(received.length)} messages
            {errors.length > 0 &&
              ` · ${errors.length} account${errors.length > 1 ? "s" : ""} not reached`}
          </span>
          <FolderFilterGroup
            shownFolders={shownFolders}
            onToggleFolder={onToggleFolder}
          />
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
                delta={{
                  value: stats.today - stats.yesterday,
                  label: "vs yesterday",
                }}
                spark={stats.todayByHour.slice(0, new Date(now).getHours() + 1)}
                sparkLabel="Messages per hour today"
                hint="See today's mail"
                onClick={() =>
                  open(
                    {
                      kind: "time",
                      start: startOfToday.getTime(),
                      end: Number.POSITIVE_INFINITY,
                    },
                    "Received today",
                    dayLong.format(startOfToday),
                  )
                }
              />
              <StatTile
                label="Last 7 days"
                value={formatCount(stats.last7)}
                delta={{
                  value: stats.last7 - stats.previous7,
                  label: "vs the week before",
                }}
                spark={stats.last14Days}
                sparkLabel="Messages per day, last 14 days"
                hint="See the last 7 days"
                onClick={() =>
                  open(
                    { kind: "all" },
                    "Last 7 days",
                    "All received mail",
                    "7d",
                  )
                }
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
                value={
                  stats.dailyAverage30 >= 10
                    ? formatCount(stats.dailyAverage30)
                    : stats.dailyAverage30.toFixed(1)
                }
                detail={busiest}
              />
            </div>

            <ChartCard
              title="Mail volume"
              subtitle={TIMELINE_SUBTITLE[range]}
              className="col-span-12 xl:col-span-8"
              action={
                <div className="flex items-center gap-3">
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {formatCount(stats.total)} total
                  </span>
                  <Tabs
                    value={volumeBy}
                    onValueChange={(next) => onVolumeByChange(next as VolumeGrouping)}
                  >
                    <TabsList aria-label="Group bars by" className="h-8 shrink-0">
                      {VOLUME_GROUPINGS.map((option) => (
                        <TabsTrigger
                          key={option.grouping}
                          value={option.grouping}
                          className="h-6 py-0 text-xs"
                        >
                          {option.label}
                        </TabsTrigger>
                      ))}
                    </TabsList>
                  </Tabs>
                </div>
              }
            >
              <ColumnChart
                columns={columns}
                ariaLabel={TIMELINE_SUBTITLE[range]}
                legend={volumeLegend}
              />
            </ChartCard>

            <ChartCard
              title="By category"
              subtitle={rangeLabel}
              className="col-span-12 xl:col-span-4"
            >
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
                  <ShowMore
                    expanded={moreSenders}
                    onToggle={() => setMoreSenders((value) => !value)}
                  />
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
                  <ShowMore
                    expanded={moreDomains}
                    onToggle={() => setMoreDomains((value) => !value)}
                  />
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
                  open(
                    { kind: "slot", weekday, hour },
                    `${weekdayName(weekday, true)}s, ${hourLabel(hour)}`,
                  )
                }
              />
            </ChartCard>

            <ChartCard
              title="Mail mix"
              subtitle={rangeLabel}
              className="col-span-12 xl:col-span-4"
            >
              <div className="flex flex-col">
                <Meter
                  label="From people"
                  icon={<UserRound className="size-4" />}
                  value={stats.people}
                  total={stats.total}
                  onPick={flag("people")}
                  hint={OPEN_HINT}
                />
                <Meter
                  label="Automated & bulk"
                  icon={<Bot className="size-4" />}
                  value={stats.automated}
                  total={stats.total}
                  onPick={flag("automated")}
                  hint={OPEN_HINT}
                />
                <Meter
                  label="Unread"
                  icon={<MailWarning className="size-4" />}
                  value={stats.unread}
                  total={stats.total}
                  onPick={flag("unread")}
                  hint={OPEN_HINT}
                />
                <Meter
                  label="With attachments"
                  icon={<Paperclip className="size-4" />}
                  value={stats.withAttachments}
                  total={stats.total}
                  onPick={flag("attachments")}
                  hint={OPEN_HINT}
                />
                <Meter
                  label="Replied to"
                  icon={<CornerUpLeft className="size-4" />}
                  value={stats.answered}
                  total={stats.total}
                  onPick={flag("answered")}
                  hint={OPEN_HINT}
                />
              </div>
            </ChartCard>

            {accounts.length > 1 && scope === "all" && (
              <ChartCard
                title="By account"
                subtitle={rangeLabel}
                className="col-span-12"
                action={<AtSign className="size-4 text-muted-foreground" />}
              >
                {accountSlices.length === 0 ? (
                  <EmptyChart />
                ) : (
                  <SegmentedBar slices={accountSlices} />
                )}
              </ChartCard>
            )}
          </div>
        )}
      </div>
    </TooltipLayer>
  );
}

function ShowMore({
  expanded,
  onToggle,
}: {
  expanded: boolean;
  onToggle: () => void;
}) {
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
  return (
    <p className="py-10 text-center text-sm text-muted-foreground">
      No mail in this period
    </p>
  );
}

function DashboardSkeleton() {
  return (
    <div
      className="mx-auto grid max-w-[1400px] grid-cols-12 gap-4"
      aria-busy="true"
      aria-label="Loading statistics"
    >
      {Array.from({ length: 4 }, (_, index) => (
        <Skeleton
          key={index}
          className="col-span-12 h-[92px] rounded-xl sm:col-span-6 xl:col-span-3"
        />
      ))}
      <Skeleton className="col-span-12 h-[290px] rounded-xl xl:col-span-8" />
      <Skeleton className="col-span-12 h-[290px] rounded-xl xl:col-span-4" />
      <Skeleton className="col-span-12 h-[320px] rounded-xl lg:col-span-6" />
      <Skeleton className="col-span-12 h-[320px] rounded-xl lg:col-span-6" />
    </div>
  );
}
