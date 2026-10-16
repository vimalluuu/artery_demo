export function formatDate(date, time = false) {
  if (!date || Number.isNaN(new Date(date).getTime())) return "Not recorded";
  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...(time ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(new Date(date));
}
