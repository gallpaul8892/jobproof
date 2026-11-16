import { createLocalStore, type LocalStore } from "../../src/db/localStore";
import { applyPragmas, migrate } from "../../src/db/migrations";
import { installDemo } from "../install";
import { chooseSamples } from "../frame";
import { MemoryDb } from "../memoryDb";
import { MemoryDemoFiles } from "../memoryFiles";
import { CanvasImageTools, sampleImage } from "../placeholder";
import { SamplePicker } from "../samplePicker";

// Replaces src/db/openStore.ts in the browser demo build only (see metro.config.js). Importing it
// is what switches the demo on: the mock API, then the phone frame, before anything is rendered.
// EXPO_PUBLIC_DEMO_HOME_URL is filled in by Expo at export time (scripts/build-pages.mjs sets it).
installDemo({ home: process.env.EXPO_PUBLIC_DEMO_HOME_URL });

let store: LocalStore | undefined;

/** The demo's store: in-memory database and files, generated pictures, a list of sample photos as the "gallery". */
export function getLocalStore(): LocalStore {
  if (!store) {
    const db = new MemoryDb();
    applyPragmas(db);
    migrate(db);
    store = createLocalStore({
      db,
      files: new MemoryDemoFiles(),
      tools: new CanvasImageTools(),
      picker: new SamplePicker((samples, limit) => chooseSamples(samples, limit, (i) => sampleImage(i).uri)),
    });
  }
  return store;
}

