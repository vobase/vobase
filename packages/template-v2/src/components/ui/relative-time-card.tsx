"use client";

import { intlFormatDistance } from "date-fns";
import { Slot as SlotPrimitive } from "radix-ui";
import * as React from "react";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";

export type RelativeTimeLength = "short" | "long";

function formatShort(date: Date, now: Date = new Date()): string {
  const diff = now.getTime() - date.getTime();
  const abs = Math.abs(diff);
  const sign = diff < 0 ? "-" : "";
  const minutes = Math.floor(abs / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);

  if (minutes < 1) return "now";
  if (minutes < 60) return `${sign}${minutes}m`;
  if (hours < 24) return `${sign}${hours}h`;
  if (days < 7) return `${sign}${days}d`;
  if (weeks < 5) return `${sign}${weeks}w`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatLong(date: Date, now: Date = new Date()): string {
  const diff = Math.abs(now.getTime() - date.getTime());
  if (diff < 60000) {
    return diff < 0 ? "in less than a minute" : "less than a minute ago";
  }
  return intlFormatDistance(date, now);
}

interface TimezoneCardProps extends React.ComponentProps<"div"> {
  date: Date;
  timezone?: string;
}

function TimezoneCard(props: TimezoneCardProps) {
  const { date, timezone, ...cardProps } = props;

  const locale = React.useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().locale,
    [],
  );

  const timezoneName = React.useMemo(
    () =>
      timezone ??
      new Intl.DateTimeFormat(locale, { timeZoneName: "shortOffset" })
        .formatToParts(date)
        .find((part) => part.type === "timeZoneName")?.value,
    [date, timezone, locale],
  );

  const { formattedDate, formattedTime } = React.useMemo(
    () => ({
      formattedDate: new Intl.DateTimeFormat(locale, {
        month: "long",
        day: "numeric",
        year: "numeric",
        timeZone: timezone,
      }).format(date),
      formattedTime: new Intl.DateTimeFormat(locale, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
        timeZone: timezone,
      }).format(date),
    }),
    [date, timezone, locale],
  );

  return (
    <div
      role="region"
      aria-label={`Time in ${timezoneName}: ${formattedDate} ${formattedTime}`}
      {...cardProps}
      className="flex items-center justify-between gap-2 text-muted-foreground text-sm"
    >
      <span className="w-fit rounded bg-accent px-1 font-medium text-xs">
        {timezoneName}
      </span>
      <div className="flex items-center gap-2">
        <time dateTime={date.toISOString()}>{formattedDate}</time>
        <time className="tabular-nums" dateTime={date.toISOString()}>
          {formattedTime}
        </time>
      </div>
    </div>
  );
}

interface RelativeTimeCardProps
  extends React.ComponentProps<"button">,
    React.ComponentProps<typeof HoverCard>,
    Pick<
      React.ComponentProps<typeof HoverCardContent>,
      | "align"
      | "side"
      | "alignOffset"
      | "sideOffset"
      | "avoidCollisions"
      | "collisionBoundary"
      | "collisionPadding"
      | "asChild"
    > {
  date: Date | string | number;
  timezones?: string[];
  updateInterval?: number;
  /**
   * Trigger display length. `long` (default) → intlFormatDistance (e.g. "2 minutes ago");
   * `short` → "2m", "1h", "3d". Below 1 minute shows "less than a minute ago" / "now"
   * so we never render precise seconds. Hover card always shows full detail.
   */
  length?: RelativeTimeLength;
}

function RelativeTimeCard(props: RelativeTimeCardProps) {
  const {
    date: dateProp,
    timezones = ["UTC"],
    open,
    defaultOpen,
    onOpenChange,
    openDelay = 500,
    closeDelay = 300,
    align,
    side,
    alignOffset,
    sideOffset,
    avoidCollisions,
    collisionBoundary,
    collisionPadding,
    updateInterval = 1000,
    length = "long",
    asChild,
    children,
    className,
    ...triggerProps
  } = props;

  const date = React.useMemo(
    () => (dateProp instanceof Date ? dateProp : new Date(dateProp)),
    [dateProp],
  );

  const locale = React.useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().locale,
    [],
  );

  const absoluteDateTime = React.useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(date),
    [date, locale],
  );

  const compute = React.useCallback(
    () => (length === "short" ? formatShort(date) : formatLong(date)),
    [date, length],
  );

  const [relativeTime, setRelativeTime] = React.useState<string>(compute);

  React.useEffect(() => {
    setRelativeTime(compute());
    const timer = setInterval(() => {
      setRelativeTime(compute());
    }, updateInterval);

    return () => clearInterval(timer);
  }, [compute, updateInterval]);

  const TriggerPrimitive = asChild ? SlotPrimitive.Slot : "button";

  return (
    <HoverCard
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      openDelay={openDelay}
      closeDelay={closeDelay}
    >
      <HoverCardTrigger asChild>
        <TriggerPrimitive
          {...triggerProps}
          className={cn(
            "inline-flex w-fit cursor-default items-center text-inherit transition-colors hover:text-foreground/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            className,
          )}
        >
          {children ?? (
            <time dateTime={date.toISOString()} suppressHydrationWarning>
              {relativeTime}
            </time>
          )}
        </TriggerPrimitive>
      </HoverCardTrigger>
      <HoverCardContent
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        avoidCollisions={avoidCollisions}
        collisionBoundary={collisionBoundary}
        collisionPadding={collisionPadding}
        className="flex w-full max-w-[420px] flex-col gap-2 p-3"
      >
        <time
          dateTime={date.toISOString()}
          className="font-medium text-foreground text-sm"
        >
          {absoluteDateTime}
        </time>
        <div role="list" className="flex flex-col gap-1">
          {timezones.map((timezone) => (
            <TimezoneCard
              key={timezone}
              role="listitem"
              date={date}
              timezone={timezone}
            />
          ))}
          <TimezoneCard role="listitem" date={date} />
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

export { RelativeTimeCard };
