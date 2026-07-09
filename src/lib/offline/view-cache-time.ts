export function formatViewCachedAt(ts: number): string {
  try {
    return new Date(ts).toLocaleString("ar-IQ", {
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return new Date(ts).toLocaleString();
  }
}
