import { useToast, type Toast } from "@/lib/toast-context";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const colors: Record<string, string> = {
    success: "bg-green-600 text-white",
    error: "bg-red-600 text-white",
    info: "bg-blue-600 text-white",
    warning: "bg-yellow-500 text-black",
  };

  return (
    <div
      className={cn(
        "pointer-events-auto flex items-start gap-2 rounded-lg px-4 py-3 shadow-lg animate-slide-up max-w-sm",
        colors[toast.type]
      )}
    >
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">{toast.title}</div>
        {toast.body && <div className="text-xs opacity-90 mt-0.5">{toast.body}</div>}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 opacity-70 hover:opacity-100 transition-opacity"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export function ToastContainer() {
  const { toasts, removeToast } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => (
        <ToastItem
          key={toast.id}
          toast={toast}
          onDismiss={() => removeToast(toast.id)}
        />
      ))}
    </div>
  );
}
