import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DataImportCard, BackupCard } from "@/components/DataAndBackupCards";

// Convex hooks are mocked at the module boundary: the component logic
// under test (file parsing, template download, validation surfacing,
// status rendering) is client-side. Server-side authorization is
// exercised in the convex functions themselves.
const useQuery = vi.fn<(...args: unknown[]) => unknown>();
const useMutation =
  vi.fn<(...args: unknown[]) => () => Promise<{ created: number; errors: number }>>(
    () => async () => ({ created: 3, errors: 0 }),
  );
const useAction =
  vi.fn<
    (...args: unknown[]) => () => Promise<{
      url: string | null;
      counts: { clients: number; matters: number; documents: number };
    }>
  >(() => async () => ({
    url: "blob:mock",
    counts: { clients: 1, matters: 2, documents: 5 },
  }));

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQuery(...args),
  useMutation: (...args: unknown[]) => useMutation(...args),
  useAction: (...args: unknown[]) => useAction(...args),
}));

vi.mock("@/convex/_generated/api", () => ({
  // Leaf references are readable strings ("backups.listRecords") so the
  // useQuery stub can identify which query a component subscribes to.
  api: new Proxy(
    {},
    {
      get: (_t, prop) =>
        new Proxy(
          {},
          {
            get: (_t2, fn) => `${String(prop)}.${String(fn)}`,
          },
        ),
    },
  ),
}));

function stubQueries() {
  useQuery.mockImplementation((fn: unknown) => {
    // Return undefined ("loading") unless the test sets a specific shape.
    return undefined;
  });
}

describe("DataImportCard", () => {
  it("renders the entity picker and column spec from the template source", async () => {
    stubQueries();
    render(<DataImportCard />);
    expect(screen.getByText("Data import")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(/Import clients/i)).toBeInTheDocument();
    });
    // Required columns for the default entity (clients) are documented.
    const nameCells = screen.getAllByText(/name/);
    expect(nameCells.length).toBeGreaterThan(0);
    expect(screen.getByText(/required/)).toBeInTheDocument();
  });

  it("downloads a template when the Template button is clicked", async () => {
    stubQueries();
    const urls: string[] = [];
    vi.stubGlobal("URL", {
      createObjectURL: () => "blob:mock",
      revokeObjectURL: (u: string) => urls.push(u),
    } as unknown as typeof URL);
    vi.stubGlobal(
      "Blob",
      class {
        constructor(public parts: unknown[]) {}
      },
    );
    render(<DataImportCard />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /template/i }));
    await waitFor(() => expect(urls.length).toBeGreaterThan(0));
  });
});

describe("BackupCard", () => {
  it("explains that restore tests must be real and manual", () => {
    stubQueries();
    render(<BackupCard />);
    expect(screen.getByText(/Backups/)).toBeInTheDocument();
    expect(
      screen.getByText(/restore has been executed in a non-production environment/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Nothing is marked verified automatically/i),
    ).toBeInTheDocument();
  });

  it("hides admin actions when capabilities are still loading", () => {
    stubQueries();
    render(<BackupCard />);
    expect(screen.queryByRole("button", { name: /export archive/i })).toBeDisabled();
  });

  it("renders recorded archive exports and restore tests", () => {
    useQuery.mockImplementation((fn: unknown) => {
      const name = String(fn);
      if (name.includes("listRecords")) {
        return [
          {
            _id: "r1",
            kind: "archive_export",
            label: "Archive export — 23 Sep 2026",
            performedAt: Date.now(),
            counts: { clients: 2, matters: 3, documents: 10 },
          },
          {
            _id: "r2",
            kind: "restore_test",
            label: "Q2 drill",
            environment: "staging",
            result: "passed",
            performedAt: Date.now(),
          },
        ];
      }
      if (name.includes("myCapabilities")) return { orgRole: "owner" };
      return undefined;
    });
    render(<BackupCard />);
    expect(screen.getByText("Archive export — 23 Sep 2026")).toBeInTheDocument();
    expect(screen.getByText("Q2 drill")).toBeInTheDocument();
    expect(screen.getByText("passed")).toBeInTheDocument();
  });
});
