import { useSyncExternalStore } from 'react';
import { DEFAULT_DATE_FORMAT, type DateFormat } from '../../types/ipc';

/*
 * The user's date/time display preference, shared by every view that shows a
 * date. It's a tiny external store: loaded once from the main process, updated
 * in place by the General settings panel, and read through `useDateFormat()` so
 * each subscriber re-renders when it changes.
 */

let current: DateFormat = DEFAULT_DATE_FORMAT;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((listener) => listener());

void window.api.app.getDateFormat().then((format) => {
  current = format;
  emit();
});

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The current date format; re-renders the caller whenever it changes. */
export function useDateFormat(): DateFormat {
  return useSyncExternalStore(subscribe, () => current);
}

/** Change the date format app-wide and persist it. */
export function setDateFormat(format: DateFormat): void {
  current = format;
  emit();
  void window.api.app.setDateFormat(format);
}

const pad = (n: number) => String(n).padStart(2, '0');

const systemDate = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});
const systemTime = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const usTime = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});
const relativeFmt = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

/** Largest-first units for relative time, each with its length in seconds. */
const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

function relative(date: Date): string {
  const seconds = (date.getTime() - Date.now()) / 1000;
  for (const [unit, size] of RELATIVE_UNITS) {
    if (Math.abs(seconds) >= size) {
      return relativeFmt.format(Math.round(seconds / size), unit);
    }
  }
  return relativeFmt.format(0, 'second');
}

function datePart(date: Date, format: DateFormat): string {
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  switch (format) {
    case 'iso':
      return `${y}-${m}-${d}`;
    case 'us':
      return `${m}/${d}/${y}`;
    case 'eu':
      return `${d}/${m}/${y}`;
    default:
      return systemDate.format(date);
  }
}

function timePart(date: Date, format: DateFormat): string {
  switch (format) {
    case 'us':
      return usTime.format(date);
    case 'iso':
    case 'eu':
      return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
    default:
      return systemTime.format(date);
  }
}

/** Format an ISO timestamp as date + time; falls back to the raw string. */
export function formatDateTime(iso: string, format: DateFormat): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  if (format === 'relative') return relative(date);
  const separator = format === 'system' ? ' · ' : ' ';
  return `${datePart(date, format)}${separator}${timePart(date, format)}`;
}

/** Format an ISO timestamp as a date only; falls back to the raw string. */
export function formatDateOnly(iso: string, format: DateFormat): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return format === 'relative' ? relative(date) : datePart(date, format);
}
