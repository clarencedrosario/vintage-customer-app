import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
  // URL.createObjectURL is unavailable in jsdom; tests stub it as needed.
  vi.unstubAllGlobals();
});
