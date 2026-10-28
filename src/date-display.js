const pad = (value) => String(value).padStart(2, '0');

// Keep years in the plan; omit them only in the interface.
export function shortDateTime(minute) {
  const date = new Date(minute * 60_000);
  if (!Number.isFinite(date.getTime())) return '';
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function parseShortDateTime(value, anchorMinute) {
  const match = /^(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})$/.exec(value.trim());
  const anchor = new Date(anchorMinute * 60_000);
  if (!match || !Number.isFinite(anchor.getTime())) return null;
  const [month, day, hour, minute] = match.slice(1).map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const candidates = [anchor.getFullYear() - 1, anchor.getFullYear(), anchor.getFullYear() + 1]
    .map((year) => new Date(year, month - 1, day, hour, minute))
    .filter((date) => date.getFullYear() >= 1970 && date.getMonth() + 1 === month && date.getDate() === day && date.getHours() === hour && date.getMinutes() === minute);
  if (!candidates.length) return null;
  const closest = candidates.reduce((best, date) => Math.abs(date - anchor) < Math.abs(best - anchor) ? date : best);
  return Math.round(closest.getTime() / 60_000);
}
