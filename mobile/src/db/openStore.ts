import { ExpoGalleryPicker } from "../capture/expoGalleryPicker";
import { ExpoImageTools } from "../capture/expoImageTools";
import { ExpoPhotoFiles } from "../files/expoPhotoFiles";
import { openLocalDb } from "./expoSqliteDb";
import { createLocalStore, type LocalStore } from "./localStore";

let store: LocalStore | undefined;

/** The app's real store: SQLite on the phone, app-private files, system photo picker. Opened once. */
export function getLocalStore(): LocalStore {
  store ??= createLocalStore({ db: openLocalDb(), files: new ExpoPhotoFiles(), tools: new ExpoImageTools(), picker: new ExpoGalleryPicker() });
  return store;
}
