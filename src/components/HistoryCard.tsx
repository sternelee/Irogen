import { HistoryEntry } from "../hooks/useConnectionHistory";
import { formatTimeAgo } from "../utils/time";

interface HistoryCardProps {
  entry: HistoryEntry;
  onConnect: (ticket: string) => void;
}

const statusColorMap: { [key in HistoryEntry["status"]]: string } = {
  Active: "success",
  Completed: "info",
  Failed: "error",
  "Waiting Input": "warning",
};

export function HistoryCard(props: HistoryCardProps) {
  const statusColor = () => statusColorMap[props.entry.status] || "neutral";

  return (
    <div
      class="card card-compact bg-base-100 shadow-sm hover:shadow-md transition-shadow cursor-pointer"
      onClick={() => props.onConnect(props.entry.ticket)}
    >
      <div class="card-body">
        <div class="flex justify-between items-start">
          <h3 class="card-title text-sm">{props.entry.title}</h3>
          <div class="text-xs text-base-content/60">
            {formatTimeAgo(props.entry.timestamp)}
          </div>
        </div>
        <p class="text-sm text-base-content/80 line-clamp-2">
          {props.entry.description}
        </p>
        <div class="card-actions justify-end mt-2">
          <div class={`badge badge-${statusColor()} badge-sm`}>
            {props.entry.status}
          </div>
        </div>
      </div>
    </div>
  );
}
