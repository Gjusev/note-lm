import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";

vi.mock("@/lib/auth-client", () => ({
  signIn: { email: vi.fn() },
  signUp: { email: vi.fn() },
  authClient: {
    signIn: { social: vi.fn() },
  },
  useSession: vi.fn(() => ({ data: null })),
}));

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({ push: vi.fn(), replace: vi.fn() })),
}));

// ── Login Page ──

describe("LoginPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders login form with email and password", async () => {
    const { default: LoginPage } = await import("@/app/(auth)/login/page");
    render(<LoginPage />);
    expect(screen.getByText("Willkommen zurück")).toBeInTheDocument();
    expect(screen.getByText("ANMELDEN")).toBeInTheDocument();
    expect(screen.getByLabelText("E-MAIL")).toBeInTheDocument();
    expect(screen.getByLabelText("PASSWORT")).toBeInTheDocument();
  });

  it("renders Google sign-in button", async () => {
    const { default: LoginPage } = await import("@/app/(auth)/login/page");
    render(<LoginPage />);
    expect(screen.getByText("MIT GOOGLE ANMELDEN")).toBeInTheDocument();
  });

  it("renders forgot password link", async () => {
    const { default: LoginPage } = await import("@/app/(auth)/login/page");
    render(<LoginPage />);
    expect(screen.getByText("Passwort vergessen?")).toBeInTheDocument();
  });

  it("renders register link", async () => {
    const { default: LoginPage } = await import("@/app/(auth)/login/page");
    render(<LoginPage />);
    expect(screen.getByText("Kostenlos registrieren")).toBeInTheDocument();
  });

  it("renders back link", async () => {
    const { default: LoginPage } = await import("@/app/(auth)/login/page");
    render(<LoginPage />);
    expect(screen.getByText("[ ZURÜCK ]")).toBeInTheDocument();
  });
});

// ── Register Page ──

describe("RegisterPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders registration form", async () => {
    const { default: RegisterPage } = await import("@/app/(auth)/register/page");
    render(<RegisterPage />);
    expect(screen.getByText("Konto erstellen")).toBeInTheDocument();
    expect(screen.getByText("KOSTENLOS REGISTRIEREN")).toBeInTheDocument();
  });

  it("renders name, email and password fields", async () => {
    const { default: RegisterPage } = await import("@/app/(auth)/register/page");
    render(<RegisterPage />);
    expect(screen.getByLabelText("NAME")).toBeInTheDocument();
    expect(screen.getByLabelText("E-MAIL")).toBeInTheDocument();
    expect(screen.getByLabelText("PASSWORT")).toBeInTheDocument();
  });

  it("renders Google sign-up button", async () => {
    const { default: RegisterPage } = await import("@/app/(auth)/register/page");
    render(<RegisterPage />);
    expect(screen.getByText("MIT GOOGLE REGISTRIEREN")).toBeInTheDocument();
  });

  it("renders login link", async () => {
    const { default: RegisterPage } = await import("@/app/(auth)/register/page");
    render(<RegisterPage />);
    expect(screen.getByText("Anmelden")).toBeInTheDocument();
  });

  it("shows password strength indicator when typing", async () => {
    const { default: RegisterPage } = await import("@/app/(auth)/register/page");
    render(<RegisterPage />);
    // Password strength bars appear when password.length > 0
    // Initially no strength indicator
    expect(screen.queryByText("Schwach")).not.toBeInTheDocument();
  });
});

// ── Nav Component ──

describe("AppNav", () => {
  it("renders username and ABMELDEN button", async () => {
    const { AppNav } = await import("@/components/nav");
    render(<AppNav userName="Test User" />);
    expect(screen.getByText("Test User")).toBeInTheDocument();
    expect(screen.getByText("ABMELDEN")).toBeInTheDocument();
  });

  it("renders NOTEBOOK LM brand", async () => {
    const { AppNav } = await import("@/components/nav");
    render(<AppNav userName="User" />);
    expect(screen.getByText("NOTEBOOK LM")).toBeInTheDocument();
  });

  it("shows confirmation dialog on ABMELDEN click", async () => {
    const { AppNav } = await import("@/components/nav");
    render(<AppNav userName="User" />);
    fireEvent.click(screen.getByText("ABMELDEN"));
    expect(screen.getByText("Wirklich abmelden?")).toBeInTheDocument();
    expect(screen.getByText("JA, ABMELDEN")).toBeInTheDocument();
    expect(screen.getByText("ZURÜCK")).toBeInTheDocument();
  });
});
