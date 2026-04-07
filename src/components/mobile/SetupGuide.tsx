import { Component, createSignal, For } from "solid-js";
import {
  Smartphone,
  ArrowRight,
  ChevronLeft,
  Server,
  Terminal,
  Cpu,
  Copy,
  Check,
} from "lucide-solid";
import { HapticFeedback } from "../../utils/mobile";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { notificationStore } from "../../stores/notificationStore";
import { Button } from "../ui/primitives";
import { i18nStore } from "../../stores/i18nStore";

interface SetupGuideProps {
  onClose: () => void;
  onSkip: () => void;
}

export const SetupGuide: Component<SetupGuideProps> = (props) => {
  const { t } = i18nStore;
  const [currentPage, setCurrentPage] = createSignal(0);
  const [copiedIndex, setCopiedIndex] = createSignal<number | null>(null);
  let scrollContainer: HTMLDivElement | undefined;

  const copyToClipboard = async (text: string, index: number) => {
    await writeText(text);
    setCopiedIndex(index);
    HapticFeedback.success();
    notificationStore.success(
      t("setupGuide.copySuccess"),
      t("setupGuide.copySuccessTitle"),
    );
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const handleScroll = (e: Event) => {
    const target = e.target as HTMLDivElement;
    const index = Math.round(target.scrollLeft / target.clientWidth);
    if (index !== currentPage()) {
      setCurrentPage(index);
      HapticFeedback.selection();
    }
  };

  const scrollToPage = (index: number) => {
    if (scrollContainer) {
      scrollContainer.scrollTo({
        left: index * scrollContainer.clientWidth,
        behavior: "smooth",
      });
    }
  };

  const pages = () => [
    {
      title: t("setupGuide.step1.title"),
      description: t("setupGuide.step1.desc"),
      icon: <Smartphone size={56} class="text-primary" stroke-width={1.5} />,
      color: "bg-primary/10",
      content: (
        <div class="w-full bg-base-200 rounded-3xl p-6 mt-4 border border-base-content/5">
          <h3 class="text-center font-black text-[10px] mb-6 text-base-content/30 uppercase tracking-[0.2em]">
            {t("setupGuide.step1.howItWorks")}
          </h3>
          <div class="flex items-center justify-between gap-1">
            <div class="flex-1 bg-base-100 rounded-xl p-3 flex flex-col items-center border border-base-content/10 shadow-sm">
              <span class="text-primary font-bold text-[10px]">
                {t("setupGuide.step1.mobile")}
              </span>
            </div>
            <ArrowRight size={14} class="text-base-content/20" />
            <div class="flex-[1.2] bg-primary rounded-xl p-3 flex flex-col items-center shadow-md">
              <span class="text-primary-content font-bold text-[10px]">
                {t("setupGuide.step1.p2p")}
              </span>
            </div>
            <ArrowRight size={14} class="text-base-content/20" />
            <div class="flex-1 bg-base-100 rounded-xl p-3 flex flex-col items-center border border-base-content/10 shadow-sm">
              <span class="text-base-content/80 font-bold text-[10px]">
                {t("setupGuide.step1.localCli")}
              </span>
            </div>
          </div>
          <p class="text-center text-[11px] mt-6 text-base-content/50 leading-relaxed font-medium">
            {t("setupGuide.step1.footer")}
          </p>
        </div>
      ),
    },
    {
      title: t("setupGuide.step2.title"),
      description: t("setupGuide.step2.desc"),
      icon: <Terminal size={56} class="text-base-content" stroke-width={1.5} />,
      color: "bg-base-200",
      content: (
        <div class="w-full mt-4">
          <div class="mockup-code bg-neutral text-neutral-content text-[11px] shadow-xl before:opacity-20 relative text-left">
            <div class="absolute right-4 top-3 z-10">
              <button
                onClick={() =>
                  copyToClipboard(
                    "curl -fsSL https://raw.githubusercontent.com/sternelee/ClawdPilot/main/install.sh | sh",
                    1,
                  )
                }
                class="btn btn-ghost btn-xs btn-square text-neutral-content/40 hover:text-primary hover:bg-primary/10"
              >
                {copiedIndex() === 1 ? (
                  <Check size={14} class="text-success-content" />
                ) : (
                  <Copy size={14} />
                )}
              </button>
            </div>
            <pre data-prefix="$" class="pr-10">
              <code>
                curl -fsSL
                https://raw.githubusercontent.com/sternelee/ClawdPilot/main/install.sh
                | sh
              </code>
            </pre>
          </div>
          <p class="text-[10px] mt-4 text-base-content/30 text-center italic font-medium">
            {t("setupGuide.step2.windowsNote")}
          </p>
        </div>
      ),
    },
    {
      title: t("setupGuide.step3.title"),
      description: t("setupGuide.step3.desc"),
      icon: <Server size={56} class="text-primary" stroke-width={1.5} />,
      color: "bg-primary/10",
      content: (
        <div class="w-full mt-4">
          <div class="mockup-code bg-neutral text-neutral-content text-[11px] shadow-xl relative text-left">
            <div class="absolute right-4 top-3 z-10">
              <button
                onClick={() => copyToClipboard("clawdpilot --daemon", 2)}
                class="btn btn-ghost btn-xs btn-square text-neutral-content/40 hover:text-primary hover:bg-primary/10"
              >
                {copiedIndex() === 2 ? (
                  <Check size={14} class="text-success-content" />
                ) : (
                  <Copy size={14} />
                )}
              </button>
            </div>
            <pre data-prefix="$">
              <code class="font-bold text-success-content">
                clawdpilot --daemon
              </code>
            </pre>
            <div class="divider divider-neutral m-0 h-1 opacity-10"></div>
            <pre class="text-warning-content/85">
              <code>iroh-ticket:bafkp7...</code>
            </pre>
          </div>
        </div>
      ),
    },
    {
      title: t("setupGuide.step4.title"),
      description: t("setupGuide.step4.desc"),
      icon: <Cpu size={56} class="text-success-content" stroke-width={1.5} />,
      color: "bg-success/10",
      content: (
        <div class="grid grid-cols-2 gap-3 mt-4">
          <div class="bg-base-200 rounded-2xl p-4 border border-base-content/5 flex flex-col items-center gap-2 shadow-sm text-center">
            <div class="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary">
              <Terminal size={16} />
            </div>
            <span class="text-[10px] font-black uppercase text-base-content/40">
              {t("setupGuide.step4.remoteControl")}
            </span>
          </div>
          <div class="bg-base-200 rounded-2xl p-4 border border-base-content/5 flex flex-col items-center gap-2 shadow-sm text-center">
            <div class="w-8 h-8 rounded-full bg-info/10 flex items-center justify-center text-info">
              <Smartphone size={16} />
            </div>
            <span class="text-[10px] font-black uppercase text-base-content/40">
              {t("setupGuide.step4.realtimeSync")}
            </span>
          </div>
        </div>
      ),
    },
  ];

  return (
    <div class="flex flex-col h-full bg-base-100 text-base-content font-sans overflow-hidden">
      {/* Header */}
      <header class="navbar px-4 pt-safe shrink-0">
        <div class="flex-none">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              if (currentPage() > 0) scrollToPage(currentPage() - 1);
              else props.onClose();
            }}
            class="rounded-full text-base-content/40 hover:text-base-content"
          >
            <ChevronLeft size={28} />
          </Button>
        </div>
        <div class="flex-1 justify-center">
          <h1 class="text-lg font-bold tracking-tight">
            {t("setupGuide.title")}
          </h1>
        </div>
        <div class="flex-none">
          <button
            onClick={() => {
              HapticFeedback.light();
              props.onSkip();
            }}
            class="btn btn-ghost btn-sm text-base-content/30 hover:text-base-content font-bold"
          >
            {t("setupGuide.skip")}
          </button>
        </div>
      </header>

      {/* Swipeable Content Area */}
      <div
        ref={scrollContainer}
        onScroll={handleScroll}
        class="flex-1 flex overflow-x-auto snap-x snap-mandatory scrollbar-hide"
        style={{ "scrollbar-width": "none", "-ms-overflow-style": "none" }}
      >
        <For each={pages()}>
          {(page) => (
            <div class="w-full h-full shrink-0 snap-center flex flex-col items-center justify-center px-10">
              <div class={`avatar placeholder mb-10`}>
                <div
                  class={`rounded-full w-32 h-32 flex items-center justify-center border border-base-content/5 shadow-inner ${page.color}`}
                >
                  {page.icon}
                </div>
              </div>

              <h2 class="text-3xl font-bold text-center mb-3 leading-tight tracking-tight">
                {page.title}
              </h2>

              <p class="text-sm text-center text-base-content/50 leading-relaxed mb-8 px-2 font-medium">
                {page.description}
              </p>

              <div class="w-full">{page.content}</div>
            </div>
          )}
        </For>
      </div>

      {/* Footer Navigation */}
      <footer class="px-8 py-6 pb-safe flex flex-col items-center shrink-0 bg-linear-to-t from-base-100 via-base-100/90 to-transparent">
        {/* Pagination Dots */}
        <div class="flex gap-2 mb-6">
          <For each={pages()}>
            {(_, i) => (
              <button
                onClick={() => scrollToPage(i())}
                class={`h-1.5 rounded-full transition-all duration-500 ${
                  i() === currentPage()
                    ? "w-6 bg-primary"
                    : "w-1.5 bg-base-content/20"
                }`}
              />
            )}
          </For>
        </div>

        <Button
          variant="primary"
          class="h-auto w-full rounded-xl py-2 mb-4 text-base font-bold text-primary-content shadow-lg shadow-base-content/10"
          onClick={() => {
            if (currentPage() === pages().length - 1) props.onClose();
            else scrollToPage(currentPage() + 1);
          }}
        >
          <span>
            {currentPage() === pages().length - 1
              ? t("setupGuide.start")
              : t("setupGuide.continue")}
          </span>
          <ArrowRight size={16} class="ml-1" />
        </Button>
      </footer>
    </div>
  );
};
