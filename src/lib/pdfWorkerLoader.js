// Registers the pdfjs legacy worker module for bundled environments
// (Convex actions): the fake-worker file lookup fails there, so the
// worker must be imported statically and assigned to globalThis — the
// documented bundler workaround. Kept as plain JS so TypeScript never
// typechecks the untyped worker module (see pdfWorkerLoader.d.ts).
export async function loadPdfWorker() {
  const worker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  globalThis.pdfjsWorker = worker;
  return worker;
}
