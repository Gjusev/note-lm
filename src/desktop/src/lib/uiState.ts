/**
 * Persisted UI state (workspace redesign phase 1).
 *
 * Mechanism: localStorage - not the engine settings, because the engine has
 * no generic settings get/set op (only settings.offline) and view state is
 * device-local, not notebook data.
 *
 * Keys:
 *   notelm.theme           -> "light" | "dark" | "system"
 *   notelm.ui              -> { [notebookId]: NotebookUiState }
 *
 * The theme is persisted as the raw setting; "system" is resolved per render
 * via a matchMedia listener, so the resolved value follows OS switches while
 * the setting itself stays "system".
 */
import { useCallback, useEffect, useState } from "react";

export type ThemeSetting = "light" | "dark" | "system";
export type ThemeValue = "light" | "dark";

const THEME_KEY = "notelm.theme";
const UI_KEY = "notelm.ui";

function resolveTheme(setting: ThemeSetting): ThemeValue {
  if (setting !== "system") return setting;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Apply the resolved theme to <html data-theme>; tokens.css keys off it. */
export function applyTheme(setting: ThemeSetting): void {
  document.documentElement.dataset.theme = resolveTheme(setting);
}

/** Theme setting + resolved value; follows OS changes while on "system". */
export function useTheme(): { setting: ThemeSetting; value: ThemeValue; set: (s: ThemeSetting) => void } {
  const [setting, setSetting] = useState<ThemeSetting>(() => {
    const raw = localStorage.getItem(THEME_KEY);
    return raw === "light" || raw === "dark" ? raw : "system";
  });
  const [value, setValue] = useState<ThemeValue>(() => resolveTheme(setting));
  useEffect(() => {
    localStorage.setItem(THEME_KEY, setting);
    applyTheme(setting);
    setValue(resolveTheme(setting));
    if (setting !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      applyTheme("system");
      setValue(resolveTheme("system"));
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [setting]);
  return { setting, value, set: setSetting };
}

/** One work view of the center column (§5: investigate / review / study). */
export type CenterView = "source" | "note" | "chat" | "calculations" | "materials" | "matrix";

/** Reader position of one source: version, page and scroll survive view
 *  switches and app restarts (mandate 3). */
export interface SourceUiState {
  versionId: string | null;
  page: number;
  scrollTop: number;
}

export interface NotebookUiState {
  navWidth: number;
  inspectorWidth: number;
  activeView: CenterView;
  selectedSourceId: string | null;
  selectedNoteId: string | null;
  selectedClaimId: string | null;
  sources: Record<string, SourceUiState>;
  /** Unsaved note content by note id, chat input under "chat". */
  drafts: Record<string, string>;
  /** Collapsed left-nav sections by section id. */
  sectionsOpen: Record<string, boolean>;
  inspectorOpen: boolean;
  navDrawerOpen: boolean;
}

export const DEFAULT_UI_STATE: NotebookUiState = {
  navWidth: 240,
  inspectorWidth: 360,
  activeView: "chat",
  selectedSourceId: null,
  selectedNoteId: null,
  selectedClaimId: null,
  sources: {},
  drafts: {},
  sectionsOpen: {},
  inspectorOpen: true,
  navDrawerOpen: false,
};

/** Per-notebook UI state, read once and written through on every update.
 *  update() takes a partial or a function like setState; unknown/older
 *  shapes fall back to defaults field by field so a schema change never
 *  crashes the workspace. */
export function useNotebookUiState(
  notebookId: string
): [NotebookUiState, (patch: Partial<NotebookUiState> | ((prev: NotebookUiState) => Partial<NotebookUiState>)) => void] {
  const [state, setState] = useState<NotebookUiState>(() => {
    try {
      const all = JSON.parse(localStorage.getItem(UI_KEY) ?? "{}") as Record<string, Partial<NotebookUiState>>;
      return { ...DEFAULT_UI_STATE, ...all[notebookId] };
    } catch {
      return { ...DEFAULT_UI_STATE };
    }
  });

  const update = useCallback(
    (patch: Partial<NotebookUiState> | ((prev: NotebookUiState) => Partial<NotebookUiState>)) => {
      setState((prev) => {
        const next = { ...prev, ...(typeof patch === "function" ? patch(prev) : patch) };
        try {
          const all = JSON.parse(localStorage.getItem(UI_KEY) ?? "{}") as Record<string, NotebookUiState>;
          all[notebookId] = next;
          localStorage.setItem(UI_KEY, JSON.stringify(all));
        } catch {
          /* storage full or blocked: keep the in-memory state working */
        }
        return next;
      });
    },
    [notebookId]
  );
  return [state, update];
}
