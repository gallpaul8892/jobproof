import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { PhotoCapture } from "../capture/captureService";
import type { GalleryPicker } from "../capture/gallery";
import type { ImageTools } from "../capture/imageTools";
import { cleanUpPhotoStorage } from "../files/orphans";
import type { PhotoFiles } from "../files/photoFiles";
import { useSession } from "../features/session/SessionProvider";
import type { UnsentItemsSource } from "../features/session/unsent";
import type { LocalDb } from "./localDb";
import { PhotoRepo, type PhotoRow } from "./photoRepo";
import { SqliteUnsentItemsSource } from "./unsentSource";

/** Everything on the phone that screens and (later) the sync engine share. Built once per app run. */
export interface LocalStore {
  db: LocalDb;
  files: PhotoFiles;
  photos: PhotoRepo;
  capture: PhotoCapture;
  picker: GalleryPicker;
  unsent: UnsentItemsSource;
  /** Observer: screens re-read after any local change (useSyncExternalStore). */
  subscribe(listener: () => void): () => void;
  getVersion(): number;
}

export function createLocalStore(parts: { db: LocalDb; files: PhotoFiles; tools: ImageTools; picker: GalleryPicker; now?: () => Date; newId?: () => string }): LocalStore {
  let version = 0;
  const listeners = new Set<() => void>();
  const changed = () => {
    version += 1;
    listeners.forEach((l) => l());
  };
  const photos = new PhotoRepo(parts.db, changed);
  return {
    db: parts.db,
    files: parts.files,
    photos,
    capture: new PhotoCapture({ repo: photos, files: parts.files, tools: parts.tools, now: parts.now, newId: parts.newId }),
    picker: parts.picker,
    unsent: new SqliteUnsentItemsSource(parts.db),
    subscribe: (l) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    getVersion: () => version,
  };
}

const LocalStoreContext = createContext<LocalStore | undefined>(undefined);

/**
 * Provides the store and, once a user is signed in, runs the startup cleanup for that user
 * (orphan files become rows, half-copies and orphan previews go). Cleanup never throws into the UI.
 */
export function LocalStoreProvider({ store, children }: { store: LocalStore; children: ReactNode }) {
  const { state } = useSession();
  const userId = state.user?.id;
  useEffect(() => {
    if (!userId) return;
    try {
      cleanUpPhotoStorage({ repo: store.photos, files: store.files, ownerUserId: userId });
    } catch {
      // Cleanup is best effort; photos already in the database are untouched by it.
    }
  }, [store, userId]);
  return <LocalStoreContext.Provider value={store}>{children}</LocalStoreContext.Provider>;
}

/** Undefined when no store is provided (a screen test that does not need one). */
export function useLocalStore(): LocalStore | undefined {
  return useContext(LocalStoreContext);
}

/** Re-renders when anything local changes; returns a number to use as a dependency. */
function useStoreVersion(store: LocalStore | undefined): number {
  return useSyncExternalStore(store?.subscribe ?? NO_SUBSCRIBE, store?.getVersion ?? ZERO);
}
const NO_SUBSCRIBE = () => () => undefined;
const ZERO = () => 0;

/** The live photos of one job for the signed-in user, oldest first. */
export function useJobPhotos(jobId: string): PhotoRow[] {
  const store = useLocalStore();
  const { state } = useSession();
  const userId = state.user?.id;
  const version = useStoreVersion(store);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` is the change signal
  return useMemo(() => (store && userId ? store.photos.listForJob(userId, jobId) : []), [store, userId, jobId, version]);
}

/** One photo of the signed-in user (undefined when missing, deleted or someone else's). */
export function useLocalPhoto(photoId: string): PhotoRow | undefined {
  const store = useLocalStore();
  const { state } = useSession();
  const userId = state.user?.id;
  const version = useStoreVersion(store);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` is the change signal
  const photo = useMemo(() => (store && userId ? store.photos.get(userId, photoId) : undefined), [store, userId, photoId, version]);
  return photo && !photo.deleted ? photo : undefined;
}

/** Does this job have a local draft (so it is "In progress" on this phone)? */
export function useHasLocalDraft(jobId: string): boolean {
  const store = useLocalStore();
  const { state } = useSession();
  const userId = state.user?.id;
  const version = useStoreVersion(store);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` is the change signal
  return useMemo(() => (store && userId ? store.photos.reportState(userId, jobId) !== undefined : false), [store, userId, jobId, version]);
}

export function useReportEditable(jobId: string): boolean {
  const store = useLocalStore();
  const { state } = useSession();
  const userId = state.user?.id;
  const version = useStoreVersion(store);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` is the change signal
  return useMemo(() => (store && userId ? store.photos.isEditable(userId, jobId) : true), [store, userId, jobId, version]);
}
