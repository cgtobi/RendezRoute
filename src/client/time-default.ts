// Default start time for the create form: the next quarter hour (the time input steps by 15 min).

/** Local hour and minute of `now`, in `timeZone` or, if the name is invalid, in the runtime zone. */
function localHourMinute(now: Date, timeZone: string): { hour: number; minute: number } {
  const options: Intl.DateTimeFormatOptions = {
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  };
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-GB", { ...options, timeZone });
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    formatter = new Intl.DateTimeFormat("en-GB", options);
  }
  const parts = formatter.formatToParts(now);
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  return { hour: read("hour") % 24, minute: read("minute") };
}

/** The first quarter hour strictly after `now` in `timeZone`, as "HH:MM" (24 hours). */
export function nextQuarterHour(now: Date, timeZone: string): string {
  const { hour, minute } = localHourMinute(now, timeZone);
  // Seconds never matter: any instant inside minute m lies before the next multiple of 15 after m.
  const total = (hour * 60 + (Math.floor(minute / 15) + 1) * 15) % (24 * 60);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}
