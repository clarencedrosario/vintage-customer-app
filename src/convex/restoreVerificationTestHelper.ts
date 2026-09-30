import { v } from "convex/values";
import { internalAction } from "./_generated/server";

// Test-only helpers for the restore-verification fixture: read a stored
// archive as text and store JSON as a file blob. Never used by the UI.
export const readArchiveJson = internalAction({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    const blob = await ctx.storage.get(args.storageId);
    if (!blob) throw new Error("Archive blob not found.");
    return blob.text();
  },
});

export const storeArchiveJson = internalAction({
  args: { json: v.string() },
  handler: async (ctx, args) => {
    const blob = new Blob([args.json], { type: "application/json" });
    const storageId = await ctx.storage.store(blob);
    return { newStorageId: storageId };
  },
});
