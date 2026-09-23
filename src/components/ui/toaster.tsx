"use client";

import { createContext, useCallback, useContext, useState } from "react";

type ToastType = "success" | "error" | "info";

interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

let nextId = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((message: string, type: ToastType = "info") => {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const borderColor: Record<ToastType, string> = {
    success: "border-green-600",
    error: "border-accent",
    info: "border-ink",
  };

  const icon: Record<ToastType, string> = {
    success: "✓",
    error: "✕",
    info: "●",
  };

  const iconColor: Record<ToastType, string> = {
    success: "text-green-600",
    error: "text-accent",
    info: "text-ink",
  };

  return (
    <ToastContext.Provider value={{ toast: addToast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 max-w-sm">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`bg-paper border-2 ${borderColor[t.type]} p-4 animate-[slideIn_0.2s_ease-out] flex items-start gap-3 shadow-[4px_4px_0px_0px_rgba(0,0,0,0.15)]`}
          >
            <span className={`text-lg font-black ${iconColor[t.type]} leading-none`}>
              {icon[t.type]}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm leading-snug">{t.message}</p>
              <p className="text-mono-label text-[0.55rem] opacity-30 mt-1">
                {t.type.toUpperCase()}
              </p>
            </div>
            <button
              onClick={() => dismiss(t.id)}
              className="text-mono-label opacity-30 hover:opacity-100 transition-opacity ml-2"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <style>{`
        @keyframes slideIn {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </ToastContext.Provider>
  );
}
