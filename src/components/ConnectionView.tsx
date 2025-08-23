import { For } from "solid-js";
import { HistoryEntry } from "../hooks/useConnectionHistory";
import { HistoryCard } from "./HistoryCard";

interface ConnectionViewProps {
  sessionTicket: string;
  setSessionTicket: (ticket: string) => void;
  handleConnect: (ticket?: string) => void;
  connecting: boolean;
  history: HistoryEntry[];
  connectionError: string | null;
}

export function ConnectionView(props: ConnectionViewProps) {
  const handleTicketKeyPress = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !props.connecting && props.sessionTicket.trim()) {
      props.handleConnect();
    }
  };

  const handleCardConnect = (ticket: string) => {
    props.setSessionTicket(ticket);
    props.handleConnect(ticket);
  };

  return (
    <div class="h-full flex flex-col lg:flex-row gap-6 p-6">
      <div class="flex-1 flex items-center justify-center">
        <div class="card w-full max-w-md bg-base-100 shadow-xl">
          <div class="card-body">
            <h1 class="card-title text-center text-2xl mb-2">
              Connect to Remote Session
            </h1>
            <p class="text-center text-base-content/70 mb-6">
              Enter a session ticket to start a secure P2P terminal session.
            </p>

            {props.connectionError && (
              <div class="alert alert-error mb-4">
                <div>
                  <strong>Connection Failed:</strong>
                  <pre class="text-xs mt-1 whitespace-pre-wrap">
                    {props.connectionError}
                  </pre>
                </div>
              </div>
            )}

            <div class="form-control mb-4">
              <div class="join">
                <input
                  type="text"
                  value={props.sessionTicket}
                  onInput={(e) => props.setSessionTicket(e.currentTarget.value)}
                  onKeyPress={handleTicketKeyPress}
                  placeholder="Enter session ticket"
                  disabled={props.connecting}
                  class="input input-bordered join-item flex-1"
                  autofocus
                />
                <button
                  class="btn btn-square join-item"
                  onClick={() => alert("QR code scanning not implemented yet.")}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M3 7V5a2 2 0 0 1 2-2h2" />
                    <path d="M17 3h2a2 2 0 0 1 2 2v2" />
                    <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
                    <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
                    <path d="M7 12h10" />
                  </svg>
                </button>
              </div>
            </div>

            <button
              class="btn btn-primary w-full"
              onClick={() => props.handleConnect()}
              disabled={props.connecting || !props.sessionTicket.trim()}
            >
              {props.connecting ? (
                <>
                  <span class="loading loading-spinner"></span>
                  Connecting...
                </>
              ) : (
                "Connect"
              )}
            </button>
          </div>
        </div>
      </div>

      {props.history.length > 0 && (
        <div class="w-full lg:w-80">
          <div class="card bg-base-100 shadow-xl h-fit">
            <div class="card-body">
              <h2 class="card-title">History</h2>
              <div class="space-y-3 max-h-96 overflow-y-auto">
                <For each={props.history}>
                  {(entry) => (
                    <HistoryCard entry={entry} onConnect={handleCardConnect} />
                  )}
                </For>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
