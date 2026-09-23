import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";

// ── Data ──
const store = {
  notebook: { _id: "nb1", title: "Test Notebook", ownerId: "user1" },
  sources: [] as unknown[],
  messages: [] as unknown[],
  notes: [] as unknown[],
  materials: [] as unknown[],
};

// Global call index — reset before each test
let callIdx = 0;

function mockUseQuery() {
  const order = [
    store.notebook,
    store.sources,
    store.messages,
    store.notes,
    store.materials,
    store.materials,
  ];
  const val = order[callIdx % order.length];
  callIdx++;
  return val;
}

// ── Mocks ──

vi.mock("convex/react", () => ({
  useQuery: vi.fn(() => mockUseQuery()),
  useMutation: vi.fn(() => vi.fn()),
}));

vi.mock("@/lib/auth-client", () => ({
  useSession: vi.fn(() => ({ data: { user: { id: "user1", name: "Test" } } })),
}));

vi.mock("next/navigation", () => ({
  useParams: vi.fn(() => ({ id: "nb1" })),
  useRouter: vi.fn(() => ({ push: vi.fn(), replace: vi.fn() })),
}));

vi.mock("@/components/ui/toaster", () => ({
  useToast: vi.fn(() => ({ toast: vi.fn() })),
}));

vi.mock("@/components/notebook/upload-dialog", () => ({
  UploadDialog: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="upload-dialog">
      <button onClick={onClose}>Close</button>
    </div>
  ),
}));

// ── Tests ──

function reset() {
  callIdx = 0;
  store.notebook = { _id: "nb1", title: "Test Notebook", ownerId: "user1" };
  store.sources = [];
  store.messages = [];
  store.notes = [];
  store.materials = [];
}

describe("NotebookPage - basic rendering", () => {
  beforeEach(reset);

  it("renders notebook title", async () => {
    const { default: NotebookPage } = await import("@/app/(protected)/app/notebooks/[id]/page");
    render(<NotebookPage />);
    expect(screen.getByText("Test Notebook")).toBeInTheDocument();
  });

  it("renders chat input", async () => {
    const { default: NotebookPage } = await import("@/app/(protected)/app/notebooks/[id]/page");
    render(<NotebookPage />);
    expect(screen.getByPlaceholderText("Frage an deine Quellen stellen...")).toBeInTheDocument();
  });

  it("renders source tabs", async () => {
    const { default: NotebookPage } = await import("@/app/(protected)/app/notebooks/[id]/page");
    render(<NotebookPage />);
    expect(screen.getByText("QUELLEN")).toBeInTheDocument();
    expect(screen.getByText("NOTIZEN")).toBeInTheDocument();
    expect(screen.getByText("URL")).toBeInTheDocument();
    expect(screen.getByText("SUCHE")).toBeInTheDocument();
  });

  it("renders upload button", async () => {
    const { default: NotebookPage } = await import("@/app/(protected)/app/notebooks/[id]/page");
    render(<NotebookPage />);
    expect(screen.getByText("+ QUELLE HINZUFÜGEN")).toBeInTheDocument();
  });
});

describe("NotebookPage - tabs", () => {
  beforeEach(reset);

  it("renders notes tab with create button", async () => {
    const { default: NotebookPage } = await import("@/app/(protected)/app/notebooks/[id]/page");
    render(<NotebookPage />);
    fireEvent.click(screen.getByText("NOTIZEN"));
    expect(screen.getByText("+ NEUE NOTIZ")).toBeInTheDocument();
  });

  it("renders URL input when URL tab clicked", async () => {
    const { default: NotebookPage } = await import("@/app/(protected)/app/notebooks/[id]/page");
    render(<NotebookPage />);
    fireEvent.click(screen.getByText("URL"));
    expect(screen.getByPlaceholderText("https://example.com/artikel")).toBeInTheDocument();
  });

  it("renders search input when SUCHE tab clicked", async () => {
    const { default: NotebookPage } = await import("@/app/(protected)/app/notebooks/[id]/page");
    render(<NotebookPage />);
    fireEvent.click(screen.getByText("SUCHE"));
    expect(screen.getByPlaceholderText("Suchbegriff eingeben...")).toBeInTheDocument();
  });
});

describe("NotebookPage - sources", () => {
  beforeEach(reset);

  it("renders source with completed status", async () => {
    store.sources = [
      { _id: "s1", fileName: "document.pdf", fileType: "application/pdf", fileSize: 2048, status: "completed" },
    ];
    const { default: NotebookPage } = await import("@/app/(protected)/app/notebooks/[id]/page");
    render(<NotebookPage />);
    expect(screen.getAllByText("document.pdf").length).toBeGreaterThanOrEqual(1);
  });

  it("renders source with error status", async () => {
    store.sources = [
      { _id: "s2", fileName: "broken.pdf", fileType: "application/pdf", fileSize: 0, status: "error", errorMessage: "Parse error" },
    ];
    const { default: NotebookPage } = await import("@/app/(protected)/app/notebooks/[id]/page");
    render(<NotebookPage />);
    expect(screen.getAllByText("broken.pdf").length).toBeGreaterThanOrEqual(1);
  });
});

describe("NotebookPage - learning materials panel", () => {
  beforeEach(reset);

  it("renders material type labels", async () => {
    const { default: NotebookPage } = await import("@/app/(protected)/app/notebooks/[id]/page");
    render(<NotebookPage />);
    expect(screen.getByText("Zusammenfassung")).toBeInTheDocument();
    expect(screen.getByText("Podcast")).toBeInTheDocument();
    expect(screen.getByText("Karteikarten")).toBeInTheDocument();
    expect(screen.getByText("Quiz")).toBeInTheDocument();
  });

  it("shows GENERIEREN button when no completed versions", async () => {
    const { default: NotebookPage } = await import("@/app/(protected)/app/notebooks/[id]/page");
    render(<NotebookPage />);
    const buttons = screen.getAllByText("GENERIEREN");
    expect(buttons.length).toBeGreaterThan(0);
  });

  it("shows ANZEIGEN button when completed versions exist", async () => {
    store.materials = [
      { _id: "lm1", type: "summary", status: "completed", content: "Summary text" },
    ];
    const { default: NotebookPage } = await import("@/app/(protected)/app/notebooks/[id]/page");
    render(<NotebookPage />);
    expect(screen.getByText("ANZEIGEN →")).toBeInTheDocument();
  });

  it("shows + NEU button for completed materials", async () => {
    store.materials = [
      { _id: "lm1", type: "summary", status: "completed", content: "Summary text" },
    ];
    const { default: NotebookPage } = await import("@/app/(protected)/app/notebooks/[id]/page");
    render(<NotebookPage />);
    expect(screen.getByText("+ NEU")).toBeInTheDocument();
  });
});
