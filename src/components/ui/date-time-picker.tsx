"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  bestSlotHighlights,
  buildPickerMonth,
  composeLocalDateTime,
  fetchBestSlots,
  formatDayLabel,
  formatMonthLabel,
  formatUtcInstant,
  parseLocalDateTime,
  shiftDayKey,
  shiftPickerMonth,
  timeOptionsForDay,
  timezoneOptions,
  validateLocalDateTime,
  zonedNow,
  type BestSlotsFetcher,
  type PickerValue,
} from "@/lib/datetime-picker";
import type { PublishSlot } from "@/lib/youtube-best-publish-times/contracts";
import { cn } from "@/lib/cn";
import { Select } from "./field";

export type { PickerValue } from "@/lib/datetime-picker";

export type DateTimePickerProps = {
  value: PickerValue | null;
  onChange: (value: PickerValue) => void;
  /** Accessible name of the day grid, e.g. "Publish date". */
  label: string;
  timeLabel?: string;
  timezoneLabel?: string;
  /** Timezone used while nothing is picked; defaults to the browser timezone. */
  timezone?: string;
  onTimezoneChange?: (timezone: string) => void;
  bestSlots?: readonly Pick<PublishSlot, "weekday" | "startHour" | "endHour">[];
  disabled?: boolean;
  /** Fixed clock for tests; the live clock is used otherwise. */
  now?: Date;
};

const WEEKDAY_HEADERS = [
  ["Mon", "Monday"], ["Tue", "Tuesday"], ["Wed", "Wednesday"], ["Thu", "Thursday"],
  ["Fri", "Friday"], ["Sat", "Saturday"], ["Sun", "Sunday"],
] as const;

const NAVIGATION_DAYS: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };

/** Loads best publish slots for the timezone while `enabled`; failures leave the picker without highlights. */
export function useBestPublishSlots(timezone: string | null, enabled: boolean, fetcher?: BestSlotsFetcher): PublishSlot[] {
  const [slots, setSlots] = useState<{ timezone: string; slots: PublishSlot[] } | null>(null);
  useEffect(() => {
    if (!enabled || !timezone || slots?.timezone === timezone) return;
    let active = true;
    void fetchBestSlots(timezone, fetcher).then((next) => {
      if (active) setSlots({ timezone, slots: next });
    });
    return () => {
      active = false;
    };
  }, [enabled, timezone, fetcher, slots?.timezone]);
  return slots?.timezone === timezone ? slots.slots : [];
}

export function DateTimePicker({
  value,
  onChange,
  label,
  timeLabel = "Time",
  timezoneLabel = "IANA timezone",
  timezone: timezoneProp,
  onTimezoneChange,
  bestSlots,
  disabled = false,
  now: fixedNow,
}: DateTimePickerProps) {
  const [liveNow, setLiveNow] = useState(() => fixedNow ?? new Date());
  const [browserZone, setBrowserZone] = useState<string | null>(null);
  const timezone = value?.timezone ?? timezoneProp ?? browserZone ?? "UTC";
  const now = fixedNow ?? liveNow;
  const selected = value ? parseLocalDateTime(value.localDateTime) : null;
  const today = zonedNow(now, timezone).date;
  const [view, setView] = useState(() => {
    const [year, month] = (selected?.date ?? today).split("-").map(Number);
    return { year, month };
  });
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const gridRef = useRef<HTMLTableElement>(null);
  const pendingFocus = useRef(false);

  useEffect(() => {
    // Resolved on the client so server rendering never uses the server's timezone.
    setBrowserZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    if (fixedNow) return;
    const timer = setInterval(() => setLiveNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, [fixedNow]);

  useEffect(() => {
    if (!pendingFocus.current || !focusedKey) return;
    pendingFocus.current = false;
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-day="${focusedKey}"]`)?.focus();
  }, [focusedKey, view]);

  const highlights = bestSlots?.length ? bestSlotHighlights(bestSlots) : undefined;
  const context = { now, timezone, highlights };
  const grid = buildPickerMonth(view.year, view.month, context);
  const days = grid.weeks.flat();
  const inView = (key: string) => days.some((day) => day.key === key && day.inMonth);
  const tabKey = [focusedKey, selected?.date, today].find((key): key is string => !!key && inView(key)) ?? days.find((day) => day.inMonth)?.key;
  const times = selected ? timeOptionsForDay(selected.date, context) : [];
  const check = value ? validateLocalDateTime(value.localDateTime, timezone, now) : null;

  function emit(date: string, time: string, zone = timezone) {
    const localDateTime = composeLocalDateTime(date, time);
    if (localDateTime) onChange({ localDateTime, timezone: zone });
  }

  function pickDay(key: string) {
    const options = timeOptionsForDay(key, context);
    const enabled = options.filter((option) => !option.disabled);
    const time =
      enabled.find((option) => option.value === selected?.time)?.value ??
      enabled.find((option) => option.recommended)?.value ??
      enabled[0]?.value ??
      selected?.time ??
      "09:00";
    setFocusedKey(key);
    emit(key, time);
  }

  function moveFocus(key: string) {
    const [year, month] = key.split("-").map(Number);
    if (year !== view.year || month !== view.month) setView({ year, month });
    pendingFocus.current = true;
    setFocusedKey(key);
  }

  function onDayKeyDown(event: KeyboardEvent<HTMLButtonElement>, key: string) {
    const index = (new Date(`${key}T00:00:00Z`).getUTCDay() + 6) % 7;
    let target: string | null = null;
    if (event.key in NAVIGATION_DAYS) target = shiftDayKey(key, NAVIGATION_DAYS[event.key]);
    else if (event.key === "Home") target = shiftDayKey(key, -index);
    else if (event.key === "End") target = shiftDayKey(key, 6 - index);
    else if (event.key === "PageUp" || event.key === "PageDown") {
      const next = shiftPickerMonth({ year: Number(key.slice(0, 4)), month: Number(key.slice(5, 7)) }, event.key === "PageUp" ? -1 : 1);
      const lastDay = new Date(Date.UTC(next.year, next.month, 0)).getUTCDate();
      target = `${next.year}-${String(next.month).padStart(2, "0")}-${String(Math.min(Number(key.slice(8)), lastDay)).padStart(2, "0")}`;
    }
    if (!target) return;
    event.preventDefault();
    moveFocus(target);
  }

  function changeTimezone(zone: string) {
    onTimezoneChange?.(zone);
    setBrowserZone(zone);
    if (selected) emit(selected.date, selected.time, zone);
  }

  return (
    <div className="space-y-3 rounded-panel border border-line bg-glass p-3">
      <div className="flex flex-col gap-4 md:flex-row">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              aria-label="Previous month"
              disabled={disabled}
              onClick={() => setView(shiftPickerMonth(view, -1))}
              className="inline-flex size-8 items-center justify-center rounded-control text-dim transition-colors hover:bg-glass-2 hover:text-fg disabled:opacity-50"
            >
              <span aria-hidden="true">‹</span>
            </button>
            <p aria-live="polite" className="font-mono text-sm font-medium text-fg">{formatMonthLabel(view.year, view.month)}</p>
            <button
              type="button"
              aria-label="Next month"
              disabled={disabled}
              onClick={() => setView(shiftPickerMonth(view, 1))}
              className="inline-flex size-8 items-center justify-center rounded-control text-dim transition-colors hover:bg-glass-2 hover:text-fg disabled:opacity-50"
            >
              <span aria-hidden="true">›</span>
            </button>
          </div>
          <table ref={gridRef} role="grid" aria-label={`${label}, ${formatMonthLabel(view.year, view.month)}`} className="border-separate border-spacing-0.5">
            <thead>
              <tr role="row">
                {WEEKDAY_HEADERS.map(([short, long]) => (
                  <th key={short} role="columnheader" scope="col" abbr={long} className="pb-1 font-mono text-[11px] font-normal uppercase text-muted">
                    {short}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.weeks.map((week) => (
                <tr key={week[0].key} role="row">
                  {week.map((day) => {
                    const isSelected = selected?.date === day.key;
                    return (
                      <td key={day.key} role="gridcell" aria-selected={isSelected} className="p-0">
                        <button
                          type="button"
                          data-day={day.key}
                          tabIndex={day.key === tabKey ? 0 : -1}
                          aria-label={`${formatDayLabel(day.key)}${day.recommended && !day.isPast ? ", best time" : ""}`}
                          aria-disabled={day.isPast || disabled || undefined}
                          aria-current={day.isToday ? "date" : undefined}
                          onClick={() => !day.isPast && !disabled && pickDay(day.key)}
                          onKeyDown={(event) => onDayKeyDown(event, day.key)}
                          className={cn(
                            "relative flex size-9 items-center justify-center rounded-control font-mono text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-rose",
                            isSelected
                              ? "bg-rose font-semibold text-canvas"
                              : day.isPast
                                ? "cursor-not-allowed text-muted opacity-40"
                                : cn("hover:bg-glass-2", day.inMonth ? "text-fg" : "text-muted"),
                            day.isToday && !isSelected && "border border-rose/40",
                          )}
                        >
                          {day.day}
                          {day.recommended && !day.isPast && (
                            <span aria-hidden="true" className={cn("absolute bottom-1 size-1 rounded-full", isSelected ? "bg-canvas" : "bg-rose")} />
                          )}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <Select
            aria-label={timeLabel}
            value={selected?.time ?? ""}
            disabled={disabled || !selected}
            onChange={(event) => selected && emit(selected.date, event.target.value)}
            className="font-mono"
          >
            {!selected && <option value="">Pick a day first</option>}
            {times.map((option) => (
              <option key={option.value} value={option.value} disabled={option.disabled}>
                {option.recommended ? `${option.value} · Best time` : option.value}
              </option>
            ))}
          </Select>
          <Select aria-label={timezoneLabel} value={timezone} disabled={disabled} onChange={(event) => changeTimezone(event.target.value)} className="font-mono">
            {timezoneOptions(timezone).map((zone) => <option key={zone} value={zone}>{zone}</option>)}
          </Select>
          {highlights && (
            <p className="flex items-center gap-2 text-xs text-subtle">
              <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-rose" />
              <span><span className="font-medium text-rose">Best time</span> — recommended from your channel&apos;s best publish times.</span>
            </p>
          )}
          <div aria-live="polite" className="space-y-0.5 text-sm">
            {!value && <p className="text-subtle">Pick a day and time.</p>}
            {value && selected && (
              <p className="font-mono text-fg">{formatDayLabel(selected.date)} · {selected.time} ({timezone})</p>
            )}
            {check?.ok && <p className="font-mono text-xs text-subtle"><time dateTime={check.utc}>{formatUtcInstant(check.utc)}</time></p>}
            {check && !check.ok && <p className="text-xs text-danger">{check.message}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
