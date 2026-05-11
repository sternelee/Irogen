import { useMemo } from "react";

// Vibing messages for thinking state — inspired by hapi
const VIBING_MESSAGES = [
  "Accomplishing", "Actioning", "Actualizing", "Baking", "Booping", "Brewing",
  "Calculating", "Cerebrating", "Channelling", "Churning", "Clauding", "Coalescing",
  "Cogitating", "Computing", "Combobulating", "Concocting", "Conjuring", "Considering",
  "Contemplating", "Cooking", "Crafting", "Creating", "Crunching", "Deciphering",
  "Deliberating", "Determining", "Discombobulating", "Divining", "Doing", "Effecting",
  "Elucidating", "Enchanting", "Envisioning", "Finagling", "Flibbertigibbeting",
  "Forging", "Forming", "Frolicking", "Generating", "Germinating", "Hatching",
  "Herding", "Honking", "Ideating", "Imagining", "Incubating", "Inferring",
  "Manifesting", "Marinating", "Meandering", "Moseying", "Mulling", "Mustering",
  "Musing", "Noodling", "Percolating", "Perusing", "Philosophising", "Pontificating",
  "Pondering", "Processing", "Puttering", "Puzzling", "Reticulating", "Ruminating",
  "Scheming", "Schlepping", "Shimmying", "Simmering", "Smooshing", "Spelunking",
  "Spinning", "Stewing", "Sussing", "Synthesizing", "Thinking", "Tinkering",
  "Transmuting", "Unfurling", "Unravelling", "Vibing", "Wandering", "Whirring",
  "Wibbling", "Wizarding", "Working", "Wrangling"
];

function formatTokenCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(value);
}

interface StatusBarProps {
  active: boolean;
  thinking: boolean;
  permissionCount?: number;
  contextSize?: number;
  contextWindow?: number | null;
  permissionMode?: string;
  model?: string | null;
  agentType?: string;
}

export function StatusBar({
  active,
  thinking,
  permissionCount = 0,
  contextSize,
  contextWindow,
  permissionMode,
  model,
  agentType,
}: StatusBarProps) {
  const connectionStatus = useMemo(() => {
    if (!active) {
      return {
        text: "Offline",
        color: "text-[#999]",
        dotColor: "bg-[#999]",
        isPulsing: false,
      };
    }

    if (permissionCount > 0) {
      return {
        text: permissionCount === 1
          ? "Permission required"
          : `${permissionCount} permissions required`,
        color: "text-[#FF9500]",
        dotColor: "bg-[#FF9500]",
        isPulsing: true,
      };
    }

    if (thinking) {
      const msg = VIBING_MESSAGES[Math.floor(Math.random() * VIBING_MESSAGES.length)];
      return {
        text: `${msg.toLowerCase()}…`,
        color: "text-[#007AFF]",
        dotColor: "bg-[#007AFF]",
        isPulsing: true,
      };
    }

    return {
      text: "Online",
      color: "text-[#34C759]",
      dotColor: "bg-[#34C759]",
      isPulsing: false,
    };
  }, [active, thinking, permissionCount]);

  const contextWarning = useMemo(() => {
    if (contextSize === undefined || !contextWindow) return null;
    const pct = (contextSize / contextWindow) * 100;
    const remaining = Math.max(0, 100 - pct);
    const percent = Math.round(remaining);
    if (remaining <= 5) {
      return { text: `${percent}% left`, color: "text-red-500" };
    }
    if (remaining <= 10) {
      return { text: `${percent}% left`, color: "text-amber-500" };
    }
    return { text: `${percent}% left`, color: "text-[var(--app-hint)]" };
  }, [contextSize, contextWindow]);

  const contextUsageLabel = useMemo(() => {
    if (contextSize === undefined) return null;
    if (!contextWindow) return `ctx ${formatTokenCount(contextSize)}`;
    const pct = Math.min(100, Math.round((contextSize / contextWindow) * 100));
    return `ctx ${formatTokenCount(contextSize)}/${formatTokenCount(contextWindow)} (${pct}%)`;
  }, [contextSize, contextWindow]);

  const displayPermissionMode = permissionMode && permissionMode !== "default"
    ? permissionMode
    : null;

  const displayModel = model && model !== "default"
    ? model
    : null;

  return (
    <div className="flex items-center justify-between px-2 pb-1">
      <div className="flex items-baseline gap-3 min-w-0">
        <div className="flex items-center gap-1.5 shrink-0">
          <span
            className={`h-2 w-2 rounded-full ${connectionStatus.dotColor} ${
              connectionStatus.isPulsing ? "animate-pulse" : ""
            }`}
          />
          <span className={`text-xs ${connectionStatus.color}`}>
            {connectionStatus.text}
          </span>
        </div>
        {contextUsageLabel ? (
          <span
            className={`text-[10px] ${contextWarning?.color ?? "text-[var(--app-hint)]"}`}
          >
            {contextUsageLabel}
            {contextWarning ? ` · ${contextWarning.text}` : ""}
          </span>
        ) : null}
      </div>

      <div className="flex min-w-0 items-center gap-2">
        {displayModel ? (
          <span className="text-xs text-[var(--app-hint)] truncate">
            {displayModel}
          </span>
        ) : null}
        {displayPermissionMode ? (
          <span className="text-xs text-[var(--app-hint)]">
            {displayPermissionMode}
          </span>
        ) : null}
        {agentType ? (
          <span className="text-[10px] text-[var(--app-hint)] opacity-60 uppercase">
            {agentType}
          </span>
        ) : null}
      </div>
    </div>
  );
}
