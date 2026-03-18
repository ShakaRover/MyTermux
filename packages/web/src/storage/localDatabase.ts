const DB_NAME = 'mytermux_web_db';
const DB_VERSION = 1;
const STORE_NAME = 'kv';

const memoryStore = new Map<string, unknown>();

function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('打开本地数据库失败'));
  });
}

async function withObjectStore<T>(
  mode: IDBTransactionMode,
  handler: (store: IDBObjectStore) => Promise<T>,
): Promise<T> {
  if (!hasIndexedDb()) {
    throw new Error('IndexedDB 不可用');
  }

  const db = await openDatabase();
  try {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    const result = await handler(store);

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('本地数据库事务失败'));
      tx.onabort = () => reject(tx.error ?? new Error('本地数据库事务中止'));
    });

    return result;
  } finally {
    db.close();
  }
}

export async function localDbGet<T>(key: string): Promise<T | null> {
  if (!hasIndexedDb()) {
    return (memoryStore.get(key) as T | undefined) ?? null;
  }

  return withObjectStore<T | null>('readonly', async (store) => {
    const request = store.get(key);
    const row = await new Promise<{ key: string; value: unknown } | undefined>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as { key: string; value: unknown } | undefined);
      request.onerror = () => reject(request.error ?? new Error('读取本地数据库失败'));
    });
    if (!row) {
      return null;
    }
    return (row.value as T) ?? null;
  });
}

export async function localDbSet<T>(key: string, value: T): Promise<void> {
  if (!hasIndexedDb()) {
    memoryStore.set(key, value);
    return;
  }

  await withObjectStore<void>('readwrite', async (store) => {
    const request = store.put({ key, value });
    await new Promise<void>((resolve, reject) => {
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error('写入本地数据库失败'));
    });
  });
}

export async function localDbDelete(key: string): Promise<void> {
  if (!hasIndexedDb()) {
    memoryStore.delete(key);
    return;
  }

  await withObjectStore<void>('readwrite', async (store) => {
    const request = store.delete(key);
    await new Promise<void>((resolve, reject) => {
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error('删除本地数据库记录失败'));
    });
  });
}

export async function localDbClearForTests(): Promise<void> {
  memoryStore.clear();
  if (!hasIndexedDb()) {
    return;
  }

  await withObjectStore<void>('readwrite', async (store) => {
    const request = store.clear();
    await new Promise<void>((resolve, reject) => {
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error('清理本地数据库失败'));
    });
  });
}
