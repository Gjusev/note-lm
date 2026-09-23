"use client";

import { useState, useRef, useCallback } from "react";
import { useToast } from "@/components/ui/toaster";

interface UploadDialogProps {
  open: boolean;
  onClose: () => void;
  notebookId: string;
  ownerId: string;
}

const ACCEPTED_TYPES: Record<string, string[]> = {
  "Dokument": [".pdf", ".txt", ".md"],
  "Audio": [".mp3", ".wav", ".m4a", ".ogg", ".webm"],
  "Video": [".mp4", ".webm", ".mov"],
};

const ALL_EXTENSIONS = Object.values(ACCEPTED_TYPES).flat().join(",");

type UploadState = "idle" | "dragging" | "uploading" | "processing" | "success" | "error";

export function UploadDialog({ open, onClose, notebookId, ownerId }: UploadDialogProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<UploadState>("idle");
  const [progress, setProgress] = useState(0);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [_dragCounter, setDragCounter] = useState(0);

  const reset = useCallback(() => {
    setState("idle");
    setProgress(0);
    setSelectedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  const processFile = useCallback(async (file: File) => {
    setSelectedFile(file);
    setState("uploading");
    setProgress(0);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("notebookId", notebookId);
    formData.append("ownerId", ownerId);

    try {
      // Simulate progress for upload phase
      const progressInterval = setInterval(() => {
        setProgress((p) => Math.min(p + Math.random() * 15, 85));
      }, 300);

      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      clearInterval(progressInterval);

      if (!res.ok) {
        const data = await res.json();
        setState("error");
        toast(data.error || "Upload fehlgeschlagen", "error");
        return;
      }

      setProgress(100);
      setState("processing");

      // Wait for processing to complete (show processing state briefly)
      await new Promise((r) => setTimeout(r, 1500));

      setState("success");
      toast(`"${file.name}" erfolgreich hinzugefügt`, "success");

      // Auto-close after success
      setTimeout(() => {
        handleClose();
      }, 1500);
    } catch {
      setState("error");
      toast("Upload fehlgeschlagen", "error");
    }
  }, [notebookId, ownerId, toast, handleClose]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  }, [processFile]);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragCounter((c) => c + 1);
    if (state === "idle") setState("dragging");
  }, [state]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragCounter((c) => {
      const next = c - 1;
      if (next === 0 && state === "dragging") setState("idle");
      return next;
    });
  }, [state]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragCounter(0);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, [processFile]);

  if (!open) return null;

  const fileSize = selectedFile ? (selectedFile.size / 1024 / 1024).toFixed(1) : "0";

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={handleClose}>
      <div
        className="bg-paper border-2 border-rule w-full max-w-lg flex flex-col animate-[dialogIn_0.2s_ease-out]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="border-b-2 border-rule px-6 py-4 flex items-center justify-between shrink-0">
          <p className="text-mono-label font-bold">&#91; QUELLE HINZUFÜGEN &#93;</p>
          <button
            onClick={handleClose}
            className="text-mono-label opacity-50 hover:opacity-100 transition-opacity"
          >
            SCHLIEẞEN ✕
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {state === "success" ? (
            <div className="text-center py-8">
              <div className="text-5xl mb-4 text-green-600 animate-[checkIn_0.3s_ease-out]">✓</div>
              <p className="text-mono-label text-green-600 mb-2">&#91; ERFOLG &#93;</p>
              <p className="text-sm">Quelle wurde erfolgreich hinzugefügt.</p>
            </div>
          ) : state === "error" ? (
            <div className="text-center py-8">
              <div className="text-5xl mb-4 text-accent">✕</div>
              <p className="text-mono-label text-accent mb-2">&#91; FEHLER &#93;</p>
              <p className="text-sm mb-4">Der Upload ist fehlgeschlagen.</p>
              <button
                onClick={reset}
                className="border-2 border-accent text-accent px-6 py-2 text-mono-label font-bold hover:bg-accent hover:text-white transition-colors"
              >
                ERNEUT VERSUCHEN
              </button>
            </div>
          ) : state === "uploading" || state === "processing" ? (
            <div className="py-4">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 border-2 border-accent flex items-center justify-center shrink-0">
                  <span className="text-mono-label text-accent font-bold">
                    {selectedFile?.name.split(".").pop()?.toUpperCase().slice(0, 3) || "FILE"}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold truncate">{selectedFile?.name}</p>
                  <p className="text-mono-label text-[0.6rem] opacity-50">{fileSize} MB</p>
                </div>
              </div>

              {/* Progress bar */}
              <div className="border-2 border-rule mb-3 h-6 relative overflow-hidden">
                <div
                  className="h-full bg-accent transition-all duration-300 ease-out"
                  style={{ width: `${progress}%` }}
                />
                <span className="absolute inset-0 flex items-center justify-center text-mono-label text-[0.6rem] font-bold text-ink mix-blend-difference">
                  {Math.round(progress)}%
                </span>
              </div>

              <p className="text-mono-label text-center text-[0.6rem] animate-pulse">
                {state === "uploading" ? "WIRD HOCHGELADEN..." : "WIRD VERARBEITET..."}
              </p>
            </div>
          ) : (
            <>
              {/* Drop zone */}
              <div
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                className={`border-2 border-dashed p-8 text-center cursor-pointer transition-colors ${
                  state === "dragging"
                    ? "border-accent bg-accent/5"
                    : "border-rule/50 hover:border-accent"
                }`}
                onClick={() => fileInputRef.current?.click()}
              >
                <div className={`text-4xl mb-3 transition-colors ${state === "dragging" ? "text-accent" : "opacity-30"}`}>
                  {state === "dragging" ? "↓" : "↑"}
                </div>
                <p className="text-mono-label mb-1">
                  {state === "dragging" ? "DATEI LOSLASSEN" : "DATEI AUSWÄHLEN ODDER ABLEGEN"}
                </p>
                <p className="text-mono-label text-[0.6rem] opacity-40">
                  Drag & Drop oder Klick zum Auswählen
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept={ALL_EXTENSIONS}
                  onChange={handleFileSelect}
                />
              </div>

              {/* File types */}
              <div className="mt-6 grid grid-cols-3 gap-3">
                {Object.entries(ACCEPTED_TYPES).map(([label, exts]) => (
                  <div key={label} className="border border-rule/30 p-3 text-center">
                    <p className="text-xs font-bold mb-1">{label}</p>
                    <p className="text-mono-label text-[0.55rem] opacity-40">
                      {exts.join(" ")}
                    </p>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Footer with limits info */}
        {state === "idle" && (
          <div className="border-t border-rule/40 px-6 py-3">
            <p className="text-mono-label text-[0.55rem] opacity-30">
              MAX: PDF 20MB · TEXT 5MB · AUDIO 50MB · VIDEO 100MB
            </p>
          </div>
        )}
      </div>

      <style>{`
        @keyframes dialogIn {
          from { transform: scale(0.95) translateY(10px); opacity: 0; }
          to { transform: scale(1) translateY(0); opacity: 1; }
        }
        @keyframes checkIn {
          from { transform: scale(0); }
          50% { transform: scale(1.2); }
          to { transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
