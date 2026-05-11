const translations: Record<string, Record<string, string>> = {
  en: {
    "loading": "Loading…",
    "sessions.title": "Sessions",
    "sessions.new": "New Session",
    "sessions.empty.title": "No sessions yet",
    "sessions.empty.hint": "Create a new session to get started.",
    "sessions.empty.startSession": "Start Session",
    "sessions.count": "{n} sessions across {m} projects",
    "newSession.title": "New Session",
    "browse.title": "Browse",
    "browse.nav": "Browse",
    "settings.title": "Settings",
    "chat.input.placeholder": "Type a message…",
    "chat.inactive": "Session is inactive",
    "device.title": "Connected Devices",
    "host.title": "Hosts",
    "host.connect": "Connect to Host",
    "confirm.cancel": "Cancel",
    "confirm.delete": "Delete",
  },
};

export function useTranslation() {
  const locale = "en";

  function t(key: string, params?: Record<string, string | number>): string {
    let text = translations[locale]?.[key] ?? key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        text = text.replace(`{${k}}`, String(v));
      }
    }
    return text;
  }

  return { t, locale };
}
