// lab-04/ui-spec.md §4.1 — list rows carry a relative time, because "4 hours
// ago" answers the question a dashboard is read to answer ("is anybody looking
// at this?") and a timestamp does not. The exact time stays available in the
// element's `title`, so nothing is lost for a reader who needs it.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Deliberately coarse: a desk cares whether something was touched minutes,
 * hours or days ago, and a figure accurate to the second would invite a reader
 * to compare two rows that are a second apart as if that mattered.
 *
 * A time in the future reads as "just now" rather than "in 3 minutes" — that
 * only happens when a clock is a little out of step, and it is not a fact worth
 * reporting to the person reading a ticket list.
 */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const elapsed = now.getTime() - new Date(iso).getTime();
  if (Number.isNaN(elapsed) || elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) return plural(Math.floor(elapsed / MINUTE), "minute");
  if (elapsed < DAY) return plural(Math.floor(elapsed / HOUR), "hour");
  return plural(Math.floor(elapsed / DAY), "day");
}

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"} ago`;
}
