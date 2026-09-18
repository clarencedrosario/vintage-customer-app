import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getCurrentUser } from "./users";
import { MATTER_STATUSES, type MatterStatus } from "./schema";

const MAX_TITLE = 120;
const MAX_DESCRIPTION = 4000;
const MAX_MESSAGE = 2000;

export const PRACTICE_AREAS = [
  "Family Law",
  "Estate & Wills",
  "Real Estate",
  "Business & Contracts",
  "Employment",
  "Personal Injury",
  "Immigration",
  "Criminal Defense",
] as const;

function titleCaseArea(area: string): string {
  return area
    .split(/[\s_-]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/** All matters belonging to the signed-in client, newest first. */
export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];

    const matters = await ctx.db
      .query("matters")
      .withIndex("by_client", (q) => q.eq("clientUserId", user._id))
      .collect();

    return matters.sort((a, b) => b.updatedAt - a.updatedAt);
  },
});

/** One matter, only if it belongs to the signed-in client. */
export const getMine = query({
  args: { matterId: v.id("matters") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    const matter = await ctx.db.get(args.matterId);
    if (!matter || matter.clientUserId !== user._id) return null;
    return matter;
  },
});

/** Correspondence thread for a matter the client owns. */
export const listMessages = query({
  args: { matterId: v.id("matters") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];

    const matter = await ctx.db.get(args.matterId);
    if (!matter || matter.clientUserId !== user._id) return [];

    const messages = await ctx.db
      .query("matterMessages")
      .withIndex("by_matter", (q) => q.eq("matterId", args.matterId))
      .collect();

    return messages.sort((a, b) => a.createdAt - b.createdAt);
  },
});

/** Status/audit timeline ("docket") for a matter the client owns. */
export const listEvents = query({
  args: { matterId: v.id("matters") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];

    const matter = await ctx.db.get(args.matterId);
    if (!matter || matter.clientUserId !== user._id) return [];

    const events = await ctx.db
      .query("matterEvents")
      .withIndex("by_matter", (q) => q.eq("matterId", args.matterId))
      .collect();

    return events.sort((a, b) => a.createdAt - b.createdAt);
  },
});

/** Submit a new legal inquiry; becomes a matter in "received" status. */
export const submitInquiry = mutation({
  args: {
    title: v.string(),
    practiceArea: v.string(),
    description: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("You must be signed in to submit an inquiry.");

    const title = args.title.trim();
    const description = args.description.trim();
    if (!title) throw new Error("Please give your matter a brief title.");
    if (title.length > MAX_TITLE)
      throw new Error(`Title must be at most ${MAX_TITLE} characters.`);
    if (!description)
      throw new Error("Please describe your situation so the firm can review it.");
    if (description.length > MAX_DESCRIPTION)
      throw new Error(
        `Description must be at most ${MAX_DESCRIPTION} characters.`,
      );

    const practiceArea = titleCaseArea(args.practiceArea.trim());
    const now = Date.now();

    const matterId = await ctx.db.insert("matters", {
      title,
      practiceArea,
      description,
      status: MATTER_STATUSES.RECEIVED,
      clientUserId: user._id,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("matterEvents", {
      matterId,
      kind: "created",
      detail: `Inquiry received — ${practiceArea}`,
      createdAt: now,
    });

    return matterId;
  },
});

/** Client posts a message on their own matter. */
export const postMessage = mutation({
  args: { matterId: v.id("matters"), body: v.string() },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("You must be signed in to send a message.");

    const matter = await ctx.db.get(args.matterId);
    if (!matter || matter.clientUserId !== user._id)
      throw new Error("Matter not found.");

    const body = args.body.trim();
    if (!body) throw new Error("Message cannot be empty.");
    if (body.length > MAX_MESSAGE)
      throw new Error(`Message must be at most ${MAX_MESSAGE} characters.`);

    const now = Date.now();
    await ctx.db.insert("matterMessages", {
      matterId: args.matterId,
      authorUserId: user._id,
      body,
      createdAt: now,
    });

    await ctx.db.insert("matterEvents", {
      matterId: args.matterId,
      kind: "message",
      detail: "Client correspondence added to the file.",
      createdAt: now,
    });

    await ctx.db.patch(args.matterId, { updatedAt: now });
  },
});

export type { MatterStatus };
