import { createSignal, Show, For, createMemo } from "solid-js";
import { HistoryEntry } from "../hooks/useConnectionHistory";
import { settingsStore, t } from "../stores/settingsStore";
import {
  EnhancedCard,
  EnhancedButton,
  EnhancedInput,
  SwipeGesture,
  PullToRefresh,
  FloatingActionButton,
} from "./ui/EnhancedComponents";

interface SessionManagementProps {
  history: HistoryEntry[];
  activeTicket: string | null;
  isConnected: boolean;
  onConnect: (ticket: string) => void;
  onDisconnect: () => void;
  onDeleteHistory: (ticket: string) => void;
  onUpdateHistory: (ticket: string, updates: Partial<HistoryEntry>) => void;
  onReturnToSession: () => void;
  onShowDetails: (entry: HistoryEntry) => void;
  onExportHistory: () => void;
  onImportHistory: () => void;
}

export function SessionManagement(props: SessionManagementProps) {
  const [viewMode, setViewMode] = createSignal<"grid" | "list">("grid");
  const [sortBy, setSortBy] = createSignal<"recent" | "name" | "status">(
    "recent",
  );
  const [filterStatus, setFilterStatus] = createSignal<
    "all" | "completed" | "failed" | "active"
  >("all");
  const [searchQuery, setSearchQuery] = createSignal("");
  const [selectedSessions, setSelectedSessions] = createSignal<string[]>([]);
  const [showBulkActions, setShowBulkActions] = createSignal(false);

  // Filtered and sorted history
  const filteredHistory = createMemo(() => {
    let filtered = props.history;

    // Apply search filter
    if (searchQuery()) {
      const query = searchQuery().toLowerCase();
      filtered = filtered.filter(
        (entry) =>
          entry.title.toLowerCase().includes(query) ||
          entry.ticket.toLowerCase().includes(query) ||
          entry.description.toLowerCase().includes(query),
      );
    }

    // Apply status filter
    if (filterStatus() !== "all") {
      if (filterStatus() === "active") {
        filtered = filtered.filter(
          (entry) => entry.ticket === props.activeTicket,
        );
      } else {
        filtered = filtered.filter(
          (entry) => entry.status.toLowerCase() === filterStatus(),
        );
      }
    }

    // Apply sorting
    switch (sortBy()) {
      case "name":
        filtered.sort((a, b) => a.title.localeCompare(b.title));
        break;
      case "status":
        filtered.sort((a, b) => a.status.localeCompare(b.status));
        break;
      case "recent":
      default:
        filtered.sort(
          (a, b) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
        );
        break;
    }

    return filtered;
  });

  const formatTimestamp = (timestamp: string | number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    if (diff < 60000) return "Just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
    return date.toLocaleDateString();
  };

  const getStatusIcon = (entry: HistoryEntry) => {
    if (props.activeTicket === entry.ticket) return "🟢";
    switch (entry.status) {
      case "Completed":
        return "✅";
      case "Failed":
        return "❌";
      case "Active":
        return "🟡";
      default:
        return "⚪";
    }
  };

  const getStatusColor = (entry: HistoryEntry) => {
    if (props.activeTicket === entry.ticket) return "border-success";
    switch (entry.status) {
      case "Completed":
        return "border-success";
      case "Failed":
        return "border-error";
      case "Active":
        return "border-warning";
      default:
        return "border-base-300";
    }
  };

  const handleBulkDelete = () => {
    selectedSessions().forEach((ticket) => {
      if (ticket !== props.activeTicket) {
        props.onDeleteHistory(ticket);
      }
    });
    setSelectedSessions([]);
    setShowBulkActions(false);
  };

  const handleSelectSession = (ticket: string) => {
    const selected = selectedSessions();
    if (selected.includes(ticket)) {
      setSelectedSessions(selected.filter((t) => t !== ticket));
    } else {
      setSelectedSessions([...selected, ticket]);
    }
  };

  const isSelected = (ticket: string) => selectedSessions().includes(ticket);

  const handleRefresh = async () => {
    // Simulate refreshing session data
    await new Promise((resolve) => setTimeout(resolve, 1000));
  };

  const renderSessionCard = (entry: HistoryEntry) => {
    const isActive = props.activeTicket === entry.ticket;
    const selected = isSelected(entry.ticket);

    return (
      <SwipeGesture
        onSwipeLeft={() => !isActive && props.onDeleteHistory(entry.ticket)}
        onSwipeRight={() => props.onConnect(entry.ticket)}
      >
        <EnhancedCard
          variant={isActive ? "featured" : "default"}
          class={`transition-all duration-200 hover:shadow-lg ${getStatusColor(entry)} ${selected ? "ring-2 ring-primary" : ""}`}
          onTap={() =>
            showBulkActions()
              ? handleSelectSession(entry.ticket)
              : props.onShowDetails(entry)
          }
        >
          <div class="space-y-3">
            {/* Header */}
            <div class="flex items-start justify-between">
              <div class="flex items-center space-x-3">
                <Show when={showBulkActions()}>
                  <input
                    type="checkbox"
                    class="checkbox checkbox-primary"
                    checked={selected}
                    onChange={() => handleSelectSession(entry.ticket)}
                  />
                </Show>
                <div class="text-2xl">{getStatusIcon(entry)}</div>
                <div class="flex-1 min-w-0">
                  <div class="font-semibold truncate">{entry.title}</div>
                  <div class="text-xs opacity-70">
                    {formatTimestamp(entry.timestamp)}
                  </div>
                </div>
              </div>

              <div class="flex items-center space-x-1">
                <Show when={isActive}>
                  <div class="badge badge-success badge-sm">ACTIVE</div>
                </Show>
                <div
                  class={`badge badge-sm ${
                    entry.status === "Completed"
                      ? "badge-success"
                      : entry.status === "Failed"
                        ? "badge-error"
                        : entry.status === "Active"
                          ? "badge-warning"
                          : "badge-neutral"
                  }`}
                >
                  {entry.status}
                </div>
              </div>
            </div>

            {/* Description */}
            <div class="text-sm opacity-70 line-clamp-2">
              {entry.description || "No description available"}
            </div>

            {/* Connection Info */}
            <div class="bg-base-200 p-2 rounded text-xs space-y-1">
              <div class="font-mono truncate">
                <span class="opacity-70">Ticket: </span>
                {entry.ticket.substring(0, 24)}...
              </div>
              <div>
                <span class="opacity-70">Created: </span>
                {formatTimestamp(entry.timestamp)}
              </div>
            </div>

            {/* Actions */}
            <div class="flex space-x-2">
              <Show when={!showBulkActions()}>
                <Show
                  when={isActive}
                  fallback={
                    <EnhancedButton
                      variant="primary"
                      size="sm"
                      onClick={() => {
                        props.onConnect(entry.ticket);
                      }}
                      icon="🚀"
                      fullWidth
                      haptic
                    >
                      Connect
                    </EnhancedButton>
                  }
                >
                  <div class="flex space-x-2 w-full">
                    <EnhancedButton
                      variant="primary"
                      size="sm"
                      onClick={() => {
                        props.onReturnToSession();
                      }}
                      icon="💻"
                      class="flex-1"
                    >
                      Open Terminal
                    </EnhancedButton>
                    <EnhancedButton
                      variant="error"
                      size="sm"
                      onClick={() => {
                        props.onDisconnect();
                      }}
                      icon="🔌"
                    >
                      End
                    </EnhancedButton>
                  </div>
                </Show>
              </Show>
            </div>
          </div>
        </EnhancedCard>
      </SwipeGesture>
    );
  };

  const renderSessionList = (entry: HistoryEntry) => {
    const isActive = props.activeTicket === entry.ticket;
    const selected = isSelected(entry.ticket);

    return (
      <SwipeGesture
        onSwipeLeft={() => !isActive && props.onDeleteHistory(entry.ticket)}
        onSwipeRight={() => props.onConnect(entry.ticket)}
      >
        <div
          class={`flex items-center space-x-3 p-3 bg-base-100 rounded-lg border ${getStatusColor(entry)} ${selected ? "ring-2 ring-primary" : ""}`}
        >
          <Show when={showBulkActions()}>
            <input
              type="checkbox"
              class="checkbox checkbox-primary"
              checked={selected}
              onChange={() => handleSelectSession(entry.ticket)}
            />
          </Show>

          <div class="text-xl">{getStatusIcon(entry)}</div>

          <div class="flex-1 min-w-0">
            <div class="flex items-center justify-between">
              <div class="font-medium truncate">{entry.title}</div>
              <div class="text-xs opacity-70">
                {formatTimestamp(entry.timestamp)}
              </div>
            </div>
            <div class="text-sm opacity-70 truncate">{entry.description}</div>
            <div class="text-xs font-mono opacity-50 truncate">
              {entry.ticket}
            </div>
          </div>

          <div class="flex items-center space-x-2">
            <Show when={isActive}>
              <div class="badge badge-success badge-xs">●</div>
            </Show>
            <Show when={!showBulkActions()}>
              <EnhancedButton
                variant={isActive ? "success" : "primary"}
                size="xs"
                onClick={() =>
                  isActive
                    ? props.onReturnToSession()
                    : props.onConnect(entry.ticket)
                }
                icon={isActive ? "💻" : "🚀"}
              >
                {isActive ? "Open" : "Connect"}
              </EnhancedButton>
            </Show>
          </div>
        </div>
      </SwipeGesture>
    );
  };

  return (
    <div class="p-4 max-w-6xl mx-auto">
      {/* Header */}
      <div class="flex items-center justify-between mb-6">
        <div>
          <h1 class="text-2xl font-bold">Session Management</h1>
          <p class="text-sm opacity-70">
            {props.history.length} total sessions •{" "}
            {props.isConnected ? "1 active" : "0 active"}
          </p>
        </div>

        <div class="flex space-x-2">
          <EnhancedButton
            variant="ghost"
            size="sm"
            onClick={() => setShowBulkActions(!showBulkActions())}
            icon="📝"
          >
            <span class="hidden sm:inline">Select</span>
          </EnhancedButton>

          <EnhancedButton
            variant="ghost"
            size="sm"
            onClick={props.onExportHistory}
            icon="📤"
          >
            <span class="hidden sm:inline">Export</span>
          </EnhancedButton>
        </div>
      </div>

      {/* Bulk Actions Bar */}
      <Show when={showBulkActions()}>
        <div class="bg-primary/10 border border-primary/20 rounded-lg p-3 mb-4">
          <div class="flex items-center justify-between">
            <div class="text-sm">
              {selectedSessions().length} sessions selected
            </div>
            <div class="flex space-x-2">
              <EnhancedButton
                variant="error"
                size="sm"
                onClick={handleBulkDelete}
                disabled={selectedSessions().length === 0}
                icon="🗑️"
              >
                Delete Selected
              </EnhancedButton>
              <EnhancedButton
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSelectedSessions([]);
                  setShowBulkActions(false);
                }}
              >
                Cancel
              </EnhancedButton>
            </div>
          </div>
        </div>
      </Show>

      {/* Search and Filters */}
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <EnhancedInput
          value={searchQuery()}
          onInput={setSearchQuery}
          placeholder="Search sessions..."
          icon="🔍"
        />

        <select
          class="select select-bordered"
          value={sortBy()}
          onChange={(e) => setSortBy(e.currentTarget.value as any)}
        >
          <option value="recent">Sort by Recent</option>
          <option value="name">Sort by Name</option>
          <option value="status">Sort by Status</option>
        </select>

        <select
          class="select select-bordered"
          value={filterStatus()}
          onChange={(e) => setFilterStatus(e.currentTarget.value as any)}
        >
          <option value="all">All Sessions</option>
          <option value="active">Active Only</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
        </select>

        <div class="flex space-x-2">
          <EnhancedButton
            variant={viewMode() === "grid" ? "primary" : "ghost"}
            size="sm"
            onClick={() => setViewMode("grid")}
            icon="⊞"
          >
            Grid
          </EnhancedButton>
          <EnhancedButton
            variant={viewMode() === "list" ? "primary" : "ghost"}
            size="sm"
            onClick={() => setViewMode("list")}
            icon="☰"
          >
            List
          </EnhancedButton>
        </div>
      </div>

      {/* Session List/Grid */}
      <Show
        when={filteredHistory().length > 0}
        fallback={
          <div class="text-center py-12">
            <div class="text-6xl mb-4">📭</div>
            <div class="text-xl font-medium mb-2">No sessions found</div>
            <div class="text-sm opacity-70 mb-4">
              {searchQuery() || filterStatus() !== "all"
                ? "Try adjusting your search or filters"
                : "Start by connecting to your first P2P session"}
            </div>
            <Show when={searchQuery() || filterStatus() !== "all"}>
              <EnhancedButton
                variant="primary"
                onClick={() => {
                  setSearchQuery("");
                  setFilterStatus("all");
                }}
              >
                Clear Filters
              </EnhancedButton>
            </Show>
          </div>
        }
      >
        <PullToRefresh onRefresh={handleRefresh}>
          <Show
            when={viewMode() === "grid"}
            fallback={
              <div class="space-y-3">
                <For each={filteredHistory()}>{renderSessionList}</For>
              </div>
            }
          >
            <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              <For each={filteredHistory()}>{renderSessionCard}</For>
            </div>
          </Show>
        </PullToRefresh>
      </Show>

      {/* Floating Action Button */}
      <FloatingActionButton
        icon="➕"
        onClick={() => {
          /* Navigate to new connection */
        }}
        variant="primary"
        position="bottom-right"
      />
    </div>
  );
}

