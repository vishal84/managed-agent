export const YMD_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function ymdToUtcDate(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}

export function dateToYmd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDaysYmd(ymd: string, days: number): string {
  const date = ymdToUtcDate(ymd);
  date.setUTCDate(date.getUTCDate() + days);
  return dateToYmd(date);
}

export function daysInclusive(startYmd: string, endYmd: string): number {
  const ms = ymdToUtcDate(endYmd).getTime() - ymdToUtcDate(startYmd).getTime();
  return Math.round(ms / 86_400_000) + 1;
}

export function formatYmd(ymd: string, options?: Intl.DateTimeFormatOptions): string {
  return ymdToUtcDate(ymd).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
    ...options,
  });
}

export function formatRange(startYmd: string, endYmd: string): string {
  if (startYmd === endYmd) return formatYmd(startYmd);
  const sameYear = startYmd.slice(0, 4) === endYmd.slice(0, 4);
  const start = formatYmd(startYmd, sameYear ? { year: undefined } : undefined);
  return `${start} – ${formatYmd(endYmd)}`;
}
