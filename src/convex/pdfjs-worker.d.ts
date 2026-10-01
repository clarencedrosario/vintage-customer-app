// pdfjs-dist ships the worker as a bare .mjs without type declarations.
// The connector registers it on globalThis (documented bundler workaround
// for the fake-worker lookup in bundled environments).
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs" {
  export const WorkerMessageHandler: unknown;
}
