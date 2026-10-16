export const DEFAULT_PREFERENCES = {
  pageSize: 10,
  showLocalActivity: true,
};
export function getPreferences() {
  try {
    const saved = JSON.parse(
      localStorage.getItem("vascuai_preferences") || "{}",
    );
    return {
      ...DEFAULT_PREFERENCES,
      showLocalActivity:
        typeof saved?.showLocalActivity === "boolean"
          ? saved.showLocalActivity
          : true,
      pageSize: [10, 20, 50].includes(Number(saved.pageSize))
        ? Number(saved.pageSize)
        : 10,
    };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}
export function savePreferences(value) {
  localStorage.setItem("vascuai_preferences", JSON.stringify(value));
}
