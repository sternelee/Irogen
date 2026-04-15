import { createSignal, createMemo, Show, type Component } from "solid-js";
import { ChatView } from "./ChatView";
import { FileBrowserView } from "./FileBrowserView";
import { GitDiffView } from "./GitDiffView";
import { sessionStore } from "../stores/sessionStore";
import { navigationStore } from "../stores/navigationStore";
import {
  FiFolder,
  FiGitBranch,
  FiX,
  FiPlus,
  FiServer,
  FiMessageSquare,
} from "solid-icons/fi";
import { notificationStore } from "../stores/notificationStore";

export const WorkspaceShell: Component = () => {
  const [rightPanelView, setRightPanelView] = createSignal<
    "none" | "file" | "git"
  >("none");

  const toggleRightPanel = (view: "file" | "git") => {
    setRightPanelView((prev) => (prev === view ? "none" : view));
  };
  const closeRightPanel = () => setRightPanelView("none");

  const activeSession = createMemo(() => sessionStore.getActiveSession());

  const handleSendMessage = (message: string) => {
    const session = activeSession();
    if (!session) {
      notificationStore.error("No active session", "Error");
      return;
    }
    if (session?.mode === "local") {
      console.log(
        "Sending message to local session:",
        session.sessionId,
        message,
      );
    } else {
      console.log(
        "Sending message to remote session:",
        session.sessionId,
        message,
      );
    }
  };

  const renderChatEmptyState = () => (
    <div class="flex flex-col h-full min-h-0 flex-1 overflow-hidden bg-background">
      <header class="z-20 flex min-h-14 shrink-0 items-center gap-3 border-b border-border/50 bg-background/80 px-4 py-3 backdrop-blur-md sm:min-h-16 sm:px-6">
        <button
          type="button"
          class="btn btn-square btn-ghost h-10 w-10 rounded-xl md:hidden"
          onClick={() => navigationStore.setSidebarOpen(true)}
          aria-label="Open menu"
        >
          <svg
            width="20"
            height="20"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            class="inline-block h-5 w-5 stroke-current"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M4 6h16M4 12h16M4 18h16"
            ></path>
          </svg>
        </button>
        <h1 class="text-lg font-semibold tracking-tight text-foreground">
          Workspace
        </h1>
      </header>
      <div class="flex flex-1 items-center justify-center p-6">
        <div class="flex flex-col items-center text-center gap-5 max-w-xs">
          <div class="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 border border-primary/20">
            <FiMessageSquare size={28} class="text-primary/60" />
          </div>
          <div>
            <p class="text-base font-semibold text-foreground">
              No active session
            </p>
            <p class="mt-1 text-sm text-muted-foreground/70">
              Start a new session or connect to a remote host
            </p>
          </div>
          <div class="flex flex-col gap-2 w-full">
            <button
              type="button"
              class="btn btn-primary btn-sm rounded-xl w-full gap-2"
              onClick={() => sessionStore.openNewSessionModal()}
            >
              <FiPlus size={15} />
              New Session
            </button>
            <button
              type="button"
              class="btn btn-ghost btn-sm rounded-xl w-full gap-2"
              onClick={() => navigationStore.setActiveView("devices")}
            >
              <FiServer size={15} />
              Connect to Host
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <Show when={activeSession()} fallback={renderChatEmptyState()}>
      {(session) => (
        <>
          <ChatView
            sessionId={session().sessionId}
            agentType={session().agentType}
            projectPath={session().projectPath}
            sessionMode={session().mode}
            sidebarOpen={navigationStore.state.sidebarOpen}
            onSendMessage={handleSendMessage}
            onToggleSidebar={() => navigationStore.setSidebarOpen(true)}
            rightPanelView={rightPanelView()}
            onToggleFileBrowser={() => toggleRightPanel("file")}
            onToggleGitPanel={() => toggleRightPanel("git")}
          />
          <Show when={rightPanelView() !== "none"}>
            <button
              type="button"
              class="fixed inset-0 z-40 h-full w-full cursor-default border-none bg-black/40 backdrop-blur-sm"
              onClick={closeRightPanel}
              aria-label="Close tools panel"
            />
          </Show>
          <aside
            class={`fixed bottom-0 left-0 right-0 z-50 h-[min(86dvh,42rem)] rounded-t-2xl border-t border-border/50 bg-base-200 shadow-2xl
              flex flex-col overflow-hidden pb-safe sm:top-0 sm:bottom-0 sm:left-auto sm:right-0 sm:h-full sm:max-h-none sm:w-80 md:w-96 lg:w-md
              transform transition-transform duration-300 ease-out
              ${rightPanelView() !== "none" ? "translate-y-0 sm:translate-x-0" : "translate-y-full sm:translate-y-0 sm:translate-x-full"}
            `}
          >
            <div class="flex justify-center py-2.5 sm:hidden">
              <div class="h-1 w-8 rounded-full bg-muted-foreground/20" />
            </div>
            <div class="flex h-12 items-center justify-between border-b border-border/50 bg-muted/30 px-4 sm:h-13">
              <div class="flex items-center gap-2 text-sm font-semibold">
                <Show
                  when={rightPanelView() === "file"}
                  fallback={<FiGitBranch size={16} class="text-primary" />}
                >
                  <FiFolder size={16} class="text-primary" />
                </Show>
                <span class="tracking-tight">
                  {rightPanelView() === "file" ? "Files" : "Git"}
                </span>
              </div>
              <button
                type="button"
                class="btn btn-ghost btn-xs btn-square h-8 w-8 rounded-lg"
                onClick={closeRightPanel}
                title="Close panel"
              >
                <FiX size={16} />
              </button>
            </div>
            <div class="flex-1 overflow-auto">
              <Show when={rightPanelView() === "file"}>
                <FileBrowserView
                  class="h-full"
                  projectPath={session()?.projectPath}
                  sessionMode={session()?.mode}
                  controlSessionId={session()?.controlSessionId}
                />
              </Show>
              <Show when={rightPanelView() === "git"}>
                <GitDiffView
                  class="h-full"
                  projectPath={session()?.projectPath}
                  sessionMode={session()?.mode}
                  controlSessionId={session()?.controlSessionId}
                />
              </Show>
            </div>
          </aside>
        </>
      )}
    </Show>
  );
};
