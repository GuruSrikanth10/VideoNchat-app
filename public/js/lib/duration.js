// "45 seconds", "12 minutes", "1 hour, 5 minutes", in the reader's language.
export function formatDuration(totalSeconds, locale = undefined) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  let parts;
  if (seconds < 60) parts = [[seconds, "second"]];
  else if (hours === 0) parts = [[minutes, "minute"]];
  else parts = [[hours, "hour"], ...(minutes ? [[minutes, "minute"]] : [])];
  const unit = ([value, name]) =>
    new Intl.NumberFormat(locale, { style: "unit", unit: name, unitDisplay: "long" }).format(value);
  return new Intl.ListFormat(locale, { style: "long", type: "unit" }).format(parts.map(unit));
}
