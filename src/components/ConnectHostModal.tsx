/**
 * ConnectHostModal Component
 *
 * Modal for connecting to a remote host via session ticket.
 */

import {
  Show,
  type Component,
  createSignal,
} from "solid-js";
import { sessionStore } from "../stores/sessionStore";
import { notificationStore } from "../stores/notificationStore";
import { FiPlus, FiCloud } from "solid-icons/fi";
import { Button } from "./ui/primitives";
import { Label } from "./ui/primitives";
import { Textarea } from "./ui/primitives";
import { Alert } from "./ui/primitives";
import { Dialog } from "./ui/primitives";

interface ConnectHostModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ConnectHostModal: Component<ConnectHostModalProps> = (props) => {
  const [isConnecting, setIsConnecting] = createSignal(false);

  const handleConnect = async () => {
    const ticket = sessionStore.state.sessionTicket.trim();
    if (!ticket) {
      notificationStore.error("Please enter a session ticket", "Connection Error");
      return;
    }

    setIsConnecting(true);
    try {
      await sessionStore.handleRemoteConnect();
      notificationStore.success("Connected to host", "Success");
      props.onClose();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      notificationStore.error(`Connection failed: ${msg}`, "Error");
    } finally {
      setIsConnecting(false);
    }
  };

  const handleClose = () => {
    sessionStore.setSessionTicket("");
    sessionStore.setConnectionError(null);
    setIsConnecting(false);
    props.onClose();
  };

  return (
    <Show when={props.isOpen}>
      <Dialog
        open={props.isOpen}
        onClose={handleClose}
        contentClass="max-w-md"
      >
        <div>
          <h3 class="font-semibold text-base mb-3 flex items-center gap-2">
            <FiCloud size={18} />
            Connect to Host
          </h3>

          <p class="text-sm text-base-content/60 mb-4">
            Enter a session ticket from a remote Irogen host to connect.
          </p>

          <div class="mb-4 space-y-2">
            <Label for="host-ticket">Session Ticket</Label>
            <Textarea
              id="host-ticket"
              class="h-24 font-mono text-sm"
              placeholder="Paste session ticket from remote host..."
              value={sessionStore.state.sessionTicket}
              onInput={(e) => {
                sessionStore.setSessionTicket(e.currentTarget.value);
                sessionStore.setConnectionError(null);
              }}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  sessionStore.state.sessionTicket.trim()
                ) {
                  e.preventDefault();
                  handleConnect();
                }
              }}
            />
          </div>

          <Show when={sessionStore.state.connectionError}>
            <Alert variant="destructive" class="mb-4 py-2">
              <span class="text-sm break-all">
                {sessionStore.state.connectionError}
              </span>
            </Alert>
          </Show>

          <div class="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleClose}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleConnect}
              disabled={!sessionStore.state.sessionTicket.trim() || isConnecting()}
              loading={isConnecting()}
            >
              <Show when={isConnecting()} fallback={<><FiPlus size={14} class="mr-1" /> Connect</>}>
                Connecting...
              </Show>
            </Button>
          </div>
        </div>
      </Dialog>
    </Show>
  );
};

export default ConnectHostModal;