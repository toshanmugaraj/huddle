import type { GemmaModelId } from './GemmaEdgeModel';

/**
 * Stores user-uploaded `.litertlm` files in the Origin Private File System
 * (OPFS) rather than bundling them into the Docker image — see the
 * discussion this replaced: a 2.8GB weight file baked into every image
 * build/push/import was real, avoidable overhead, and this widget's whole
 * design is already "bring your own copy" for the Gemini API key, so the
 * same shape fits here too.
 *
 * OPFS over IndexedDB: it's a real virtual filesystem the origin can write
 * large files into, a better fit for a multi-GB blob than IndexedDB's
 * object-store model. Same caveat as localStorage's use elsewhere in this
 * app: this widget runs in a cross-origin iframe, and OPFS may be
 * partitioned or refused entirely on strict browsers (Safari's third-party
 * storage blocking especially) — every call here is defensive for exactly
 * that reason, and callers should treat "storage unavailable" as an
 * expected outcome, not a bug.
 */

const OPFS_DIR = 'gemma-models';

function fileNameFor(modelId: GemmaModelId): string {
  return `${modelId}.litertlm`;
}

async function getModelsDir(create: boolean): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(OPFS_DIR, { create });
}

export async function isStorageAvailable(): Promise<boolean> {
  try {
    await getModelsDir(true);
    return true;
  } catch {
    return false;
  }
}

export async function hasStoredModel(modelId: GemmaModelId): Promise<boolean> {
  try {
    const dir = await getModelsDir(false);
    await dir.getFileHandle(fileNameFor(modelId));
    return true;
  } catch {
    return false;
  }
}

export async function getStoredModelSize(modelId: GemmaModelId): Promise<number | undefined> {
  try {
    const dir = await getModelsDir(false);
    const handle = await dir.getFileHandle(fileNameFor(modelId));
    const file = await handle.getFile();
    return file.size;
  } catch {
    return undefined;
  }
}

/**
 * Streams `file` into OPFS in chunks rather than materializing it as one
 * in-memory buffer first — the whole point given these files run multiple
 * GB. `onProgress` reports bytes written so far / file.size.
 */
export async function storeModelFile(
  modelId: GemmaModelId,
  file: File,
  onProgress?: (written: number, total: number) => void,
): Promise<void> {
  const dir = await getModelsDir(true);
  const handle = await dir.getFileHandle(fileNameFor(modelId), { create: true });
  const writable = await handle.createWritable();
  const reader = file.stream().getReader();
  let written = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      await writable.write(value);
      written += value.byteLength;
      onProgress?.(written, file.size);
    }
    await writable.close();
  } catch (err) {
    await writable.abort().catch(() => {});
    throw err;
  }
}

/**
 * The stored file itself, undefined if nothing's stored (or storage isn't
 * available). A `File` is a `Blob`, which is exactly what LiteRT-LM's
 * `EngineSettings.model` accepts directly — no reader/stream wrapping
 * needed on this end (`Engine.create` calls `.stream()` on it internally).
 */
export async function getStoredModelFile(modelId: GemmaModelId): Promise<File | undefined> {
  try {
    const dir = await getModelsDir(false);
    const handle = await dir.getFileHandle(fileNameFor(modelId));
    return await handle.getFile();
  } catch {
    return undefined;
  }
}

export async function deleteStoredModel(modelId: GemmaModelId): Promise<void> {
  try {
    const dir = await getModelsDir(false);
    await dir.removeEntry(fileNameFor(modelId));
  } catch {
    // Already gone (or storage unavailable) — fine, deletion is idempotent.
  }
}
