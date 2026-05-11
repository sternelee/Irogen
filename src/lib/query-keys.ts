export const queryKeys = {
  sessions: ["sessions"] as const,
  session: (id: string) => ["session", id] as const,
  devices: ["devices"] as const,
  connections: ["connections"] as const,
  files: (path: string) => ["files", path] as const,
  fileContent: (path: string) => ["fileContent", path] as const,
  settings: ["settings"] as const,
};
