import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Small hand-built charts for the Dashboard. One accent hue for single-series marks; entities
 * that already have a color in the app (categories, accounts) keep it. Marks are thin, with
 * 4px rounded data ends and 2px surface gaps; every mark has a hover tooltip and, where it
 * stands for mail, opens that mail on click.
 */

export const ACCENT = "hsl(var(--sidebar-primary))";
export const accentAlpha = (alpha: number) => `hsl(var(--sidebar-primary) / ${alpha})`;

const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
const full = new Intl.NumberFormat();

/** Full under 10,000, compact above (12.9K). */
export function formatCount(value: number): string {
  return Math.abs(value) >= 10_000 ? compact.format(value) : full.format(Math.round(value));
}

export function formatPercent(part: number, whole: number): string {
  if (whole <= 0) return "0%";
  const share = (part / whole) * 100;
  return `${share > 0 && share < 1 ? "<1" : Math.round(share)}%`;
}

// --- Tooltip -----------------------------------------------------------------------------------

export interface TipContent {
  title: string;
  rows?: { label: string; value: string; color?: string }[];
  /** What a click does, shown last in muted ink. */
  hint?: string;
}

interface TipState extends TipContent {
  x: number;
  y: number;
}

interface TipApi {
  show: (event: React.PointerEvent | React.FocusEvent, content: TipContent) => void;
  hide: () => void;
}

const TipContext = createContext<TipApi>({ show: () => undefined, hide: () => undefined });

/** Hosts the one tooltip every chart below shares. */
export function TooltipLayer({ children }: { children: ReactNode }) {
  const [tip, setTip] = useState<TipState | null>(null);
  const show = useCallback<TipApi["show"]>((event, content) => {
    let x: number;
    let y: number;
    if ("clientX" in event) {
      x = event.clientX;
      y = event.clientY;
    } else {
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      x = rect.left + rect.width / 2;
      y = rect.bottom;
    }
    setTip({ ...content, x, y });
  }, []);
  const hide = useCallback(() => setTip(null), []);
  const api = useMemo(() => ({ show, hide }), [show, hide]);

  return (
    <TipContext.Provider value={api}>
      {children}
      {tip && (
        <div
          role="tooltip"
          className="pointer-events-none fixed z-50 min-w-[140px] max-w-[260px] rounded-lg border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg"
          style={{
            left: Math.min(tip.x + 14, window.innerWidth - 270),
            top: Math.min(tip.y + 14, window.innerHeight - 120),
          }}
        >
          <div className="font-medium">{tip.title}</div>
          {tip.rows?.map((row) => (
            <div key={row.label} className="mt-1 flex items-center gap-2">
              {row.color && <span className="size-2 shrink-0 rounded-full" style={{ background: row.color }} />}
              <span className="flex-1 text-muted-foreground">{row.label}</span>
              <span className="tabular-nums">{row.value}</span>
            </div>
          ))}
          {tip.hint && <div className="mt-1.5 text-muted-foreground">{tip.hint}</div>}
        </div>
      )}
    </TipContext.Provider>
  );
}

/** Pointer and keyboard handlers that show `content` on a mark. */
export function useTip(content: TipContent | null) {
  const { show, hide } = useContext(TipContext);
  if (!content) return {};
  return {
    onPointerEnter: (event: React.PointerEvent) => show(event, content),
    onPointerMove: (event: React.PointerEvent) => show(event, content),
    onPointerLeave: hide,
    onFocus: (event: React.FocusEvent) => show(event, content),
    onBlur: hide,
  };
}

function TipButton({
  tip,
  onClick,
  className,
  style,
  children,
  label,
  disabled,
}: {
  tip: TipContent;
  onClick?: () => void;
  className?: string;
  style?: React.CSSProperties;
  children?: ReactNode;
  label: string;
  disabled?: boolean;
}) {
  const handlers = useTip(tip);
  const { hide } = useContext(TipContext);
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled || !onClick}
      onClick={() => {
        hide();
        onClick?.();
      }}
      className={cn("outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default", className)}
      style={style}
      {...handlers}
    >
      {children}
    </button>
  );
}

// --- Card --------------------------------------------------------------------------------------

export function ChartCard({
  title,
  subtitle,
  action,
  className,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("corner-squircle flex min-w-0 flex-col rounded-xl border border-border bg-card p-5", className)}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

// --- Stat tile + sparkline ---------------------------------------------------------------------

function Sparkline({ values, label }: { values: readonly number[]; label: string }) {
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? 100 / (values.length - 1) : 100;
  const points = values.map((value, index) => [index * step, 30 - (value / max) * 26] as const);
  const line = points.map(([x, y]) => `${x},${y}`).join(" ");
  const last = points[points.length - 1];
  return (
    <div className="relative h-8 w-24 shrink-0" role="img" aria-label={label}>
      <svg viewBox="0 0 100 32" preserveAspectRatio="none" className="size-full overflow-visible">
        <polygon points={`0,32 ${line} 100,32`} fill={accentAlpha(0.1)} />
        <polyline
          points={line}
          fill="none"
          stroke={ACCENT}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {last && (
        <span
          className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card"
          style={{ left: `${last[0]}%`, top: `${(last[1] / 32) * 100}%`, background: ACCENT }}
        />
      )}
    </div>
  );
}

export interface StatDelta {
  /** Signed change. */
  value: number;
  /** "vs yesterday". */
  label: string;
}

export function StatTile({
  label,
  value,
  delta,
  detail,
  spark,
  sparkLabel,
  onClick,
  hint,
}: {
  label: string;
  value: string;
  delta?: StatDelta;
  /** A line under the value when there is no delta. */
  detail?: string;
  spark?: readonly number[];
  sparkLabel?: string;
  onClick?: () => void;
  hint?: string;
}) {
  const DeltaIcon = !delta || delta.value === 0 ? ArrowRight : delta.value > 0 ? ArrowUpRight : ArrowDownRight;
  const body = (
    <>
      <div className="min-w-0 flex-1">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
        <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
          {delta ? (
            <>
              <DeltaIcon className="size-3.5" aria-hidden />
              <span className="tabular-nums text-foreground/80">
                {delta.value > 0 ? "+" : ""}
                {formatCount(delta.value)}
              </span>
              <span>{delta.label}</span>
            </>
          ) : (
            <span className="truncate">{detail}</span>
          )}
        </div>
      </div>
      {spark && <Sparkline values={spark} label={sparkLabel ?? label} />}
    </>
  );
  const className =
    "corner-squircle flex min-w-0 items-end gap-3 rounded-xl border border-border bg-card p-4 text-left";
  if (!onClick) return <div className={className}>{body}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      title={hint}
      className={cn(
        className,
        "outline-none transition-colors hover:border-foreground/20 hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      {body}
    </button>
  );
}

// --- Column chart ------------------------------------------------------------------------------

/** Clean axis ticks from 0: steps of 1, 2 or 5 × 10ⁿ, at most four above zero. */
export function niceTicks(max: number): number[] {
  if (max <= 0) return [0, 1];
  const rough = max / 4;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((factor) => factor * power).find((candidate) => candidate >= rough) ?? power * 10;
  const unit = Math.max(1, step);
  const ticks: number[] = [];
  for (let tick = 0; tick < max + unit; tick += unit) {
    ticks.push(tick);
    if (tick >= max) break;
  }
  return ticks;
}

/** One stacked part of a column, listed from the baseline up. */
export interface ColumnSegment {
  key: string;
  /** Series name, as in the legend ("Unread"). */
  label: string;
  value: number;
  color: string;
  onPick?: () => void;
}

export interface Column {
  key: string;
  /** Tooltip title, e.g. the bucket's date. */
  title: string;
  segments: readonly ColumnSegment[];
  /** Axis label; empty strings are skipped to keep labels apart. */
  axisLabel: string;
  /** A click on the column outside its segments: the whole bucket. */
  onPick?: () => void;
}

export interface LegendEntry {
  label: string;
  color: string;
}

function columnTotal(column: Column): number {
  return column.segments.reduce((sum, segment) => sum + segment.value, 0);
}

/**
 * Columns from one baseline, each stacked from its segments with 2px gaps; the top segment
 * carries the 4px rounded end. A legend names the series whenever there is more than one.
 */
export function ColumnChart({
  columns,
  ariaLabel,
  legend,
}: {
  columns: readonly Column[];
  ariaLabel: string;
  legend?: readonly LegendEntry[];
}) {
  const max = Math.max(0, ...columns.map(columnTotal));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1] || 1;
  const every = Math.max(1, Math.ceil(columns.length / 8));

  return (
    <div className="flex flex-col" role="group" aria-label={ariaLabel}>
      {legend && legend.length > 1 && (
        <div className="mb-3 ml-8 flex items-center gap-4 text-xs text-muted-foreground">
          {legend.map((entry) => (
            <span key={entry.label} className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-[3px]" style={{ background: entry.color }} />
              {entry.label}
            </span>
          ))}
        </div>
      )}
      <div className="flex h-48">
        <div className="relative w-8 shrink-0">
          {ticks.map((tick) => (
            <span
              key={tick}
              className="absolute right-2 text-[11px] leading-none tabular-nums text-muted-foreground"
              style={{ bottom: `${(tick / top) * 100}%`, transform: "translateY(50%)" }}
            >
              {formatCount(tick)}
            </span>
          ))}
        </div>
        <div className="relative flex-1">
          {ticks.map((tick) => (
            <span
              key={tick}
              className="absolute inset-x-0 h-px bg-border"
              style={{ bottom: `${(tick / top) * 100}%` }}
            />
          ))}
          <div className="absolute inset-0 flex items-stretch gap-[2px]">
            {columns.map((column) => (
              <ColumnView key={column.key} column={column} top={top} />
            ))}
          </div>
        </div>
      </div>
      <div className="ml-8 mt-2 flex gap-[2px]">
        {columns.map((column, index) => (
          <span
            key={column.key}
            className="min-w-0 flex-1 overflow-visible whitespace-nowrap text-center text-[11px] text-muted-foreground"
          >
            {/* Counted back from the newest column, so the latest one is always labeled. */}
            {(columns.length - 1 - index) % every === 0 ? column.axisLabel : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

function ColumnView({ column, top }: { column: Column; top: number }) {
  const total = columnTotal(column);
  const rows = [
    ...[...column.segments].reverse().map((segment) => ({
      label: segment.label,
      value: formatCount(segment.value),
      color: segment.color,
    })),
    ...(column.segments.length > 1 ? [{ label: "Total", value: formatCount(total) }] : []),
  ];
  const columnTip = useTip({ title: column.title, rows, hint: total > 0 ? "Click to see these messages" : undefined });
  const shown = column.segments.filter((segment) => segment.value > 0);

  return (
    <div
      className={cn(
        "group flex min-w-0 flex-1 flex-col items-center justify-end gap-[2px] rounded-sm hover:bg-accent/40",
        total > 0 && column.onPick && "cursor-pointer",
      )}
      onClick={total > 0 ? column.onPick : undefined}
      {...columnTip}
    >
      {[...shown].reverse().map((segment, index) => (
        <SegmentButton
          key={segment.key}
          column={column}
          segment={segment}
          rows={rows}
          isTop={index === 0}
          height={`${(segment.value / top) * 100}%`}
        />
      ))}
    </div>
  );
}

function SegmentButton({
  column,
  segment,
  rows,
  isTop,
  height,
}: {
  column: Column;
  segment: ColumnSegment;
  rows: TipContent["rows"];
  isTop: boolean;
  height: string;
}) {
  const handlers = useTip({
    title: column.title,
    rows,
    hint: `Click to see the ${segment.label.toLowerCase()} ones`,
  });
  const { hide } = useContext(TipContext);
  return (
    <button
      type="button"
      aria-label={`${column.title}, ${segment.label}: ${segment.value}`}
      disabled={!segment.onPick}
      onClick={(event) => {
        event.stopPropagation();
        hide();
        segment.onPick?.();
      }}
      className={cn(
        "block w-full max-w-[24px] shrink-0 outline-none transition-[filter] hover:brightness-125 focus-visible:ring-2 focus-visible:ring-ring",
        isTop && "rounded-t-[4px]",
      )}
      style={{ height, minHeight: 3, background: segment.color }}
      {...handlers}
      // The column under it shows its own tooltip on move; this segment's wins while hovered.
      onPointerMove={(event) => {
        event.stopPropagation();
        handlers.onPointerMove?.(event);
      }}
    />
  );
}

// --- Bar list ----------------------------------------------------------------------------------

export interface BarRow {
  key: string;
  label: string;
  sublabel?: string;
  value: number;
  leading?: ReactNode;
  tip: TipContent;
  onPick?: () => void;
}

/** Ranked horizontal bars with the label on the left and the value at the bar's tip. */
export function BarList({ rows, empty }: { rows: readonly BarRow[]; empty: string }) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  if (rows.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="-mx-2 flex flex-col">
      {rows.map((row) => (
        <li key={row.key}>
          <TipButton
            tip={row.tip}
            label={`${row.label}: ${row.value}`}
            onClick={row.onPick}
            className="group grid w-full grid-cols-[20px_minmax(0,38%)_minmax(0,1fr)] items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent/50"
          >
            <span className="flex size-5 items-center justify-center">{row.leading}</span>
            <span className="min-w-0">
              <span className="block truncate text-sm">{row.label}</span>
              {row.sublabel && <span className="block truncate text-[11px] text-muted-foreground">{row.sublabel}</span>}
            </span>
            <span className="flex min-w-0 items-center gap-2">
              <span
                className="h-2.5 rounded-r-[4px] transition-[filter] group-hover:brightness-110"
                style={{ width: `calc(${(row.value / max) * 100}% - 2.5rem)`, minWidth: 3, background: ACCENT }}
              />
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatCount(row.value)}</span>
            </span>
          </TipButton>
        </li>
      ))}
    </ul>
  );
}

// --- Donut -------------------------------------------------------------------------------------

export interface Slice {
  key: string;
  label: string;
  value: number;
  color: string;
  leading?: ReactNode;
  onPick?: () => void;
  hint?: string;
}

/** Parts of one whole: a ring with 2px gaps and a legend that names and counts every part. */
export function Donut({ slices, totalLabel }: { slices: readonly Slice[]; totalLabel: string }) {
  const [hovered, setHovered] = useState<string | null>(null);
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const gap = slices.filter((slice) => slice.value > 0).length > 1 ? 2.5 : 0;
  const active = slices.find((slice) => slice.key === hovered);

  let offset = 0;
  const arcs = slices
    .filter((slice) => slice.value > 0)
    .map((slice) => {
      const length = (slice.value / total) * circumference;
      const arc = { slice, dash: Math.max(0.5, length - gap), offset };
      offset += length;
      return arc;
    });

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start xl:flex-col xl:items-center 2xl:flex-row 2xl:items-start">
      <div className="relative size-40 shrink-0">
        <svg viewBox="0 0 140 140" className="size-full -rotate-90">
          {total === 0 && <circle cx={70} cy={70} r={radius} fill="none" stroke="hsl(var(--muted))" strokeWidth={16} />}
          {arcs.map(({ slice, dash, offset: start }) => (
            <circle
              key={slice.key}
              cx={70}
              cy={70}
              r={radius}
              fill="none"
              stroke={slice.color}
              strokeWidth={hovered === slice.key ? 20 : 16}
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={-start}
              className={cn("transition-[stroke-width,opacity]", slice.onPick && "cursor-pointer")}
              style={{ opacity: hovered && hovered !== slice.key ? 0.45 : 1 }}
              onPointerEnter={() => setHovered(slice.key)}
              onPointerLeave={() => setHovered(null)}
              onClick={slice.onPick}
            />
          ))}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-xl font-semibold tabular-nums">{formatCount(active ? active.value : total)}</span>
          <span className="max-w-[90px] truncate text-[11px] text-muted-foreground">
            {active ? `${active.label} · ${formatPercent(active.value, total)}` : totalLabel}
          </span>
        </div>
      </div>
      <ul className="flex w-full min-w-0 flex-col">
        {slices.map((slice) => (
          <li key={slice.key}>
            <button
              type="button"
              disabled={!slice.onPick}
              title={slice.hint}
              onClick={slice.onPick}
              onPointerEnter={() => setHovered(slice.key)}
              onPointerLeave={() => setHovered(null)}
              onFocus={() => setHovered(slice.key)}
              onBlur={() => setHovered(null)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm outline-none transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring",
                hovered === slice.key && "bg-accent/50",
              )}
            >
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: slice.color }} />
              {slice.leading}
              <span className="min-w-0 flex-1 truncate">{slice.label}</span>
              <span className="text-xs tabular-nums text-muted-foreground">{formatCount(slice.value)}</span>
              <span className="w-9 text-right text-xs tabular-nums text-muted-foreground">
                {formatPercent(slice.value, total)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// --- Heatmap -----------------------------------------------------------------------------------

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const LONG_WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function weekdayName(weekday: number, long = false): string {
  return (long ? LONG_WEEKDAYS : WEEKDAYS)[weekday] ?? "";
}

export function hourLabel(hour: number): string {
  const date = new Date(2000, 0, 1, hour);
  return new Intl.DateTimeFormat(undefined, { hour: "numeric" }).format(date);
}

/** One-hue ramp: near the surface for little mail, full accent for the busiest slot. */
function heatColor(count: number, max: number): string {
  if (count === 0 || max === 0) return "hsl(var(--muted) / 0.7)";
  const steps = [0.22, 0.4, 0.58, 0.78, 1];
  const index = Math.min(steps.length - 1, Math.floor((count / max) * steps.length - 1e-9));
  return accentAlpha(steps[Math.max(0, index)]);
}

export function Heatmap({
  grid,
  max,
  onPick,
}: {
  grid: readonly (readonly number[])[];
  max: number;
  onPick: (weekday: number, hour: number) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-[36px_repeat(24,minmax(0,1fr))] gap-[2px]">
        <span />
        {Array.from({ length: 24 }, (_, hour) => (
          <span key={hour} className="whitespace-nowrap text-[10px] text-muted-foreground">
            {hour % 6 === 0 ? hourLabel(hour) : ""}
          </span>
        ))}
        {grid.map((row, weekday) => (
          <HeatRow key={weekday} weekday={weekday} row={row} max={max} onPick={onPick} />
        ))}
      </div>
      <div className="flex items-center justify-end gap-1.5 text-[11px] text-muted-foreground">
        Less
        {[0, 0.22, 0.4, 0.58, 0.78, 1].map((alpha) => (
          <span
            key={alpha}
            className="size-3 rounded-[3px]"
            style={{ background: alpha === 0 ? "hsl(var(--muted) / 0.7)" : accentAlpha(alpha) }}
          />
        ))}
        More
      </div>
    </div>
  );
}

function HeatRow({
  weekday,
  row,
  max,
  onPick,
}: {
  weekday: number;
  row: readonly number[];
  max: number;
  onPick: (weekday: number, hour: number) => void;
}) {
  return (
    <>
      <span className="self-center text-[11px] text-muted-foreground">{weekdayName(weekday)}</span>
      {row.map((count, hour) => (
        <TipButton
          key={hour}
          label={`${weekdayName(weekday, true)} ${hourLabel(hour)}: ${count}`}
          tip={{
            title: `${weekdayName(weekday, true)}s, ${hourLabel(hour)}–${hourLabel((hour + 1) % 24)}`,
            rows: [{ label: "Messages", value: formatCount(count) }],
            hint: count > 0 ? "Click to see them" : undefined,
          }}
          onClick={count > 0 ? () => onPick(weekday, hour) : undefined}
          className="aspect-square min-h-3 rounded-[3px] transition-transform hover:scale-110 enabled:hover:ring-1 enabled:hover:ring-foreground/40"
          style={{ background: heatColor(count, max) }}
        />
      ))}
    </>
  );
}

// --- Segmented bar & meters --------------------------------------------------------------------

/** One whole split into parts, with 2px gaps; a legend below names and counts each. */
export function SegmentedBar({ slices }: { slices: readonly Slice[] }) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const shown = slices.filter((slice) => slice.value > 0);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex h-3 gap-[2px]">
        {shown.map((slice, index) => (
          <TipButton
            key={slice.key}
            label={`${slice.label}: ${slice.value}`}
            tip={{
              title: slice.label,
              rows: [
                { label: "Messages", value: formatCount(slice.value), color: slice.color },
                { label: "Share", value: formatPercent(slice.value, total) },
              ],
              hint: slice.hint,
            }}
            onClick={slice.onPick}
            className={cn(
              "h-full transition-[filter] hover:brightness-110",
              index === 0 && "rounded-l-[4px]",
              index === shown.length - 1 && "rounded-r-[4px]",
            )}
            style={{ flexGrow: slice.value, flexBasis: 0, background: slice.color, minWidth: 4 }}
          />
        ))}
      </div>
      <ul className="-mx-2 grid grid-cols-1 gap-x-4 sm:grid-cols-2 xl:grid-cols-3">
        {slices.map((slice) => (
          <li key={slice.key}>
            <button
              type="button"
              disabled={!slice.onPick}
              title={slice.hint}
              onClick={slice.onPick}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm outline-none transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: slice.color }} />
              {slice.leading}
              <span className="min-w-0 flex-1 truncate">{slice.label}</span>
              <span className="text-xs tabular-nums text-muted-foreground">{formatCount(slice.value)}</span>
              <span className="w-9 text-right text-xs tabular-nums text-muted-foreground">
                {formatPercent(slice.value, total)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A labeled share of the total: the fill is the accent, the track a lighter step of it. */
export function Meter({
  label,
  icon,
  value,
  total,
  onPick,
  hint,
}: {
  label: string;
  icon?: ReactNode;
  value: number;
  total: number;
  onPick?: () => void;
  hint?: string;
}) {
  return (
    <button
      type="button"
      disabled={!onPick || value === 0}
      title={hint}
      onClick={onPick}
      className="-mx-2 flex flex-col gap-1.5 rounded-lg px-2 py-2 text-left outline-none transition-colors enabled:hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex w-full items-center gap-2 text-sm">
        <span className="text-muted-foreground">{icon}</span>
        <span className="flex-1">{label}</span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {formatCount(value)} · {formatPercent(value, total)}
        </span>
      </span>
      <span className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: accentAlpha(0.15) }}>
        <span
          className="block h-full rounded-full"
          style={{ width: total > 0 ? `${(value / total) * 100}%` : 0, background: ACCENT }}
        />
      </span>
    </button>
  );
}
