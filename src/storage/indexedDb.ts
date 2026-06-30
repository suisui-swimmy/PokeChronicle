import type { BattleLogDocument } from "../core/events/schema";
import type { ImportedTemplateCollection } from "../core/templates/importedTemplates";

const DATABASE_NAME = "pokechronicle";
const DATABASE_VERSION = 2;
const BATTLE_LOG_STORE = "battleLogs";
const TEMPLATE_IMPORT_STORE = "templateImports";

export interface StoredBattleLogRecord {
  id: string;
  updatedAt: string;
  document: BattleLogDocument;
}

export interface StoredTemplateImportRecord {
  id: string;
  importedAt: string;
  collection: ImportedTemplateCollection;
}

export interface IndexedDbAdapterOptions {
  indexedDb?: IDBFactory;
}

function getIndexedDbFactory(options?: IndexedDbAdapterOptions) {
  return options?.indexedDb ?? globalThis.indexedDB ?? null;
}

export function isIndexedDbSupported(options?: IndexedDbAdapterOptions) {
  return getIndexedDbFactory(options) !== null;
}

function requestToPromise<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error ?? new Error("IndexedDB error")));
  });
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve());
    transaction.addEventListener("abort", () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted")),
    );
    transaction.addEventListener("error", () =>
      reject(transaction.error ?? new Error("IndexedDB transaction error")),
    );
  });
}

async function openDatabase(options?: IndexedDbAdapterOptions) {
  const indexedDb = getIndexedDbFactory(options);

  if (!indexedDb) {
    throw new Error("IndexedDB is not available in this browser.");
  }

  const request = indexedDb.open(DATABASE_NAME, DATABASE_VERSION);

  request.addEventListener("upgradeneeded", () => {
    const database = request.result;
    const transaction = request.transaction;

    const store = database.objectStoreNames.contains(BATTLE_LOG_STORE)
      ? transaction?.objectStore(BATTLE_LOG_STORE)
      : database.createObjectStore(BATTLE_LOG_STORE, { keyPath: "id" });

    if (store && !store.indexNames.contains("updatedAt")) {
      store.createIndex("updatedAt", "updatedAt");
    }

    const templateStore = database.objectStoreNames.contains(TEMPLATE_IMPORT_STORE)
      ? transaction?.objectStore(TEMPLATE_IMPORT_STORE)
      : database.createObjectStore(TEMPLATE_IMPORT_STORE, { keyPath: "id" });

    if (templateStore && !templateStore.indexNames.contains("importedAt")) {
      templateStore.createIndex("importedAt", "importedAt");
    }
  });

  return requestToPromise(request);
}

export async function saveBattleLogDocument(
  document: BattleLogDocument,
  options?: IndexedDbAdapterOptions,
) {
  const database = await openDatabase(options);
  const record: StoredBattleLogRecord = {
    id: document.battle.id,
    updatedAt: new Date().toISOString(),
    document,
  };

  try {
    const transaction = database.transaction(BATTLE_LOG_STORE, "readwrite");
    transaction.objectStore(BATTLE_LOG_STORE).put(record);
    await transactionDone(transaction);
  } finally {
    database.close();
  }

  return record;
}

export async function loadBattleLogDocument(
  battleId: string,
  options?: IndexedDbAdapterOptions,
) {
  const database = await openDatabase(options);

  try {
    const transaction = database.transaction(BATTLE_LOG_STORE, "readonly");
    const request = transaction.objectStore(BATTLE_LOG_STORE).get(battleId);
    const record = await requestToPromise<StoredBattleLogRecord | undefined>(request);
    await transactionDone(transaction);

    return record?.document ?? null;
  } finally {
    database.close();
  }
}

export async function loadLatestBattleLogDocument(options?: IndexedDbAdapterOptions) {
  const database = await openDatabase(options);

  try {
    const transaction = database.transaction(BATTLE_LOG_STORE, "readonly");
    const store = transaction.objectStore(BATTLE_LOG_STORE);
    const index = store.index("updatedAt");
    const request = index.openCursor(null, "prev");
    const record = await new Promise<StoredBattleLogRecord | null>((resolve, reject) => {
      request.addEventListener("success", () => {
        resolve((request.result?.value as StoredBattleLogRecord | undefined) ?? null);
      });
      request.addEventListener("error", () =>
        reject(request.error ?? new Error("IndexedDB cursor error")),
      );
    });
    await transactionDone(transaction);

    return record?.document ?? null;
  } finally {
    database.close();
  }
}

export async function saveImportedTemplateCollection(
  collection: ImportedTemplateCollection,
  options?: IndexedDbAdapterOptions,
) {
  const database = await openDatabase(options);
  const record: StoredTemplateImportRecord = {
    id: collection.id,
    importedAt: collection.importedAt,
    collection,
  };

  try {
    const transaction = database.transaction(TEMPLATE_IMPORT_STORE, "readwrite");
    transaction.objectStore(TEMPLATE_IMPORT_STORE).put(record);
    await transactionDone(transaction);
  } finally {
    database.close();
  }

  return record;
}

export async function loadLatestImportedTemplateCollection(
  options?: IndexedDbAdapterOptions,
) {
  const database = await openDatabase(options);

  try {
    const transaction = database.transaction(TEMPLATE_IMPORT_STORE, "readonly");
    const store = transaction.objectStore(TEMPLATE_IMPORT_STORE);
    const index = store.index("importedAt");
    const request = index.openCursor(null, "prev");
    const record = await new Promise<StoredTemplateImportRecord | null>((resolve, reject) => {
      request.addEventListener("success", () => {
        resolve((request.result?.value as StoredTemplateImportRecord | undefined) ?? null);
      });
      request.addEventListener("error", () =>
        reject(request.error ?? new Error("IndexedDB cursor error")),
      );
    });
    await transactionDone(transaction);

    return record?.collection ?? null;
  } finally {
    database.close();
  }
}

export async function clearImportedTemplateCollections(options?: IndexedDbAdapterOptions) {
  const database = await openDatabase(options);

  try {
    const transaction = database.transaction(TEMPLATE_IMPORT_STORE, "readwrite");
    transaction.objectStore(TEMPLATE_IMPORT_STORE).clear();
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}
