/**
 * Offline court mode — device-side storage (section 27).
 *
 * Bundles live in IndexedDB under a per-user store, so another signed-in
 * account in the same browser profile never sees them inside the app,
 * and a sign-out keeps them only until the user removes them. The store
 * is explicit: the Offline Centre lists exactly what is on this device
 * and a Remove button wipes it. Nothing outside the selected bundle is
 * ever cached — the app never keeps a local copy of the firm database.
 *
 * Honest limits, repeated in the UI:
 *  - Storage is plain IndexedDB; protections are those of the browser
 *    profile. A shared computer exposes its contents to other users of
 *    the same OS account. Offline mode is opt-in for exactly this reason.
 *  - Revocation is not instant while a device is disconnected.
 */

export type OfflineNote = {
  _id: string;
  body: string;
  fromClient: boolean;
  createdAt: number;
};

export type OfflinePayload = {
  version: number;
  generatedAt: number;
  org?: { name: string };
  matter: {
    reference: string;
    title: string;
    court: string | null;
    bench: string | null;
    caseNumber: string | null;
  };
  clientName: string;
  hearing: {
    title: string;
    at: number;
    court: string | null;
    courtroom: string | null;
    judge: string | null;
    purpose: string | null;
    prepNotes: string | null;
    requiredDocuments: string[];
  } | null;
  orders: {
    _id: string;
    title: string;
    passedOn: number;
    summary: string | null;
    directions: { text: string; done: boolean }[];
  }[];
  chronology: {
    detail: string;
    occurredAt: number;
    datePrecision: string;
    sourceRef: string | null;
  }[];
  notes: OfflineNote[];
  documents: {
    _id: string;
    name: string;
    visibility: string;
    updatedAt: number;
  }[];
  parties: { side: string; name: string; counsel: string | null }[];
};

export type OfflineBundleRecord = {
  bundleId: string;
  userId: string;
  matterId: string;
  matterLabel: string;
  orgName: string;
  deviceLabel: string;
  fingerprint: string;
  preparedAt: number;
  syncedAt: number;
  expiresAt: number;
  payload: OfflinePayload;
};

export type QueuedNote = {
  id: string;
  bundleId: string;
  body: string;
  queuedAt: number;
  baseSyncedAt: number;
};

const DB_NAME = "advokate-offline";
const DB_VERSION = 1;
const STORE = "bundles";
const QUEUE = "queue";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "bundleId" });
      }
      if (!db.objectStoreNames.contains(QUEUE)) {
        db.createObjectStore(QUEUE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB unavailable."));
  });
}

function tx<T>(
  db: IDBDatabase,
  store: string,
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = run(t.objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB error."));
  });
}

// ---------------------------------------------------------------------
// Device identity — stable per browser profile
// ---------------------------------------------------------------------

const DEVICE_KEY = "advokate.offline.deviceId";

export function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

export function deviceLabel(): string {
  const ua = navigator.userAgent;
  const os = /Windows/i.test(ua)
    ? "Windows"
    : /Mac/i.test(ua)
      ? "Mac"
      : /Android/i.test(ua)
        ? "Android"
        : /iPhone|iPad/i.test(ua)
          ? "iOS"
          : /Linux/i.test(ua)
            ? "Linux"
            : "Device";
  const browser = /Edg\//i.test(ua)
    ? "Edge"
    : /Chrome\//i.test(ua)
      ? "Chrome"
      : /Firefox\//i.test(ua)
        ? "Firefox"
        : /Safari\//i.test(ua)
          ? "Safari"
          : "Browser";
  return `${browser} on ${os}`;
}

// ---------------------------------------------------------------------
// Bundle storage
// ---------------------------------------------------------------------

export async function saveBundle(record: OfflineBundleRecord): Promise<void> {
  const db = await openDb();
  try {
    await tx(db, STORE, "readwrite", (s) => s.put(record));
  } finally {
    db.close();
  }
}

export async function listBundles(
  userId: string,
): Promise<OfflineBundleRecord[]> {
  const db = await openDb();
  try {
    const all = await tx<OfflineBundleRecord[]>(db, STORE, "readonly", (s) =>
      s.getAll() as IDBRequest<OfflineBundleRecord[]>,
    );
    return all
      .filter((r) => r.userId === userId)
      .sort((a, b) => b.preparedAt - a.preparedAt);
  } finally {
    db.close();
  }
}

export async function removeBundle(bundleId: string): Promise<void> {
  const db = await openDb();
  try {
    await tx(db, STORE, "readwrite", (s) => s.delete(bundleId));
  } finally {
    db.close();
  }
}

export async function wipeAllForUser(userId: string): Promise<void> {
  const db = await openDb();
  try {
    const all = await tx<OfflineBundleRecord[]>(db, STORE, "readonly", (s) =>
      s.getAll() as IDBRequest<OfflineBundleRecord[]>,
    );
    for (const r of all.filter((x) => x.userId === userId)) {
      await tx(db, STORE, "readwrite", (s) => s.delete(r.bundleId));
    }
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------
// Queued note updates (typed offline, drained on reconnect)
// ---------------------------------------------------------------------

export async function enqueueNote(note: QueuedNote): Promise<void> {
  const db = await openDb();
  try {
    await tx(db, QUEUE, "readwrite", (s) => s.put(note));
  } finally {
    db.close();
  }
}

export async function listQueuedNotes(): Promise<QueuedNote[]> {
  const db = await openDb();
  try {
    const all = await tx<QueuedNote[]>(db, QUEUE, "readonly", (s) =>
      s.getAll() as IDBRequest<QueuedNote[]>,
    );
    return all.sort((a, b) => a.queuedAt - b.queuedAt);
  } finally {
    db.close();
  }
}

export async function clearQueuedNote(id: string): Promise<void> {
  const db = await openDb();
  try {
    await tx(db, QUEUE, "readwrite", (s) => s.delete(id));
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------
// Connectivity status
// ---------------------------------------------------------------------

export function isProbablyOnline(): boolean {
  return typeof navigator !== "undefined" ? navigator.onLine : true;
}
