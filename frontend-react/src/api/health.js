import axios from "axios";

// Health probes must not use the authenticated API client: a separately hosted
// VITE_HEALTH_URL must never receive a user's bearer token.
const monitor = axios.create({
  timeout: 10_000,
  headers: { Accept: "application/json" },
});

export async function checkHealth(
  baseUrl = import.meta.env.VITE_HEALTH_URL || "/health",
) {
  const root = baseUrl.replace(/\/+$/, "");
  const results = await Promise.allSettled([
    monitor.get(root),
    monitor.get(`${root}/ready`),
  ]);
  return {
    checkedAt: new Date().toISOString(),
    checks: results.map((result, index) => ({
      label: index === 0 ? "API availability" : "Database readiness",
      available:
        result.status === "fulfilled" &&
        result.value.data?.status === (index === 0 ? "healthy" : "ready"),
      detail:
        result.status === "fulfilled"
          ? result.value.data?.status || "Unexpected health response"
          : result.reason.response?.status === 503
            ? "Service unavailable"
            : result.reason.message,
    })),
  };
}
