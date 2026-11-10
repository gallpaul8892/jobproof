import type { PhotoRepo } from "../db/photoRepo";
import type { PhotoFiles } from "./photoFiles";
import { PART_SUFFIX, parseOriginalName, thumbsDir, userDir } from "./paths";

export interface CleanupReport {
  /** Files with no row that now have one (a kill between the file move and the row insert). */
  recovered: number;
  /** Files with no row and no known job: kept untouched, never deleted. */
  unattached: number;
  /** Half-copied `.part` files removed. */
  partialsRemoved: number;
  /** Previews with no photo, removed (they are rebuildable). */
  thumbsRemoved: number;
  /** Deleted photos whose files and row were finished off. */
  deletesFinished: number;
}

/**
 * Startup cleanup for one user (design 3.6 step 3, T-003e "orphan cleanup"). Safe to run any
 * number of times, and it NEVER deletes a photo that could be evidence:
 *  - a `<id>.jpg` with no row becomes a row, attached to the job the camera was last opened for,
 *    at the last-used stage, flagged `recovered` so the operative is told to check the stage;
 *  - if no job is known the file stays where it is and is counted as `unattached`;
 *  - only `.part` files (incomplete copies; the source is still in the gallery) and previews are deleted.
 */
export function cleanUpPhotoStorage(deps: { repo: PhotoRepo; files: PhotoFiles; ownerUserId: string; now?: () => Date }): CleanupReport {
  const { repo, files, ownerUserId } = deps;
  const now = deps.now ?? (() => new Date());
  const report: CleanupReport = { recovered: 0, unattached: 0, partialsRemoved: 0, thumbsRemoved: 0, deletesFinished: 0 };
  const dir = userDir(ownerUserId);

  // 1. Finish deletes that were interrupted (flag committed, files not yet removed).
  for (const row of repo.pendingLocalDeletes(ownerUserId)) {
    files.remove(row.original_path);
    if (row.thumb_path) files.remove(row.thumb_path);
    if (row.upload_path) files.remove(row.upload_path);
    repo.purge(ownerUserId, row.id);
    report.deletesFinished += 1;
  }

  // 2. Originals.
  const known = repo.knownIds(ownerUserId);
  const job = repo.captureIntent(ownerUserId);
  for (const name of files.list(dir)) {
    const rel = `${dir}/${name}`;
    if (name.endsWith(PART_SUFFIX)) {
      files.remove(rel);
      report.partialsRemoved += 1;
      continue;
    }
    const parsed = parseOriginalName(name);
    if (!parsed || known.has(parsed.id)) continue;
    const size = files.size(rel);
    if (!job || !size) {
      report.unattached += 1;
      continue;
    }
    if (repo.idTaken(parsed.id)) {
      report.unattached += 1; // someone else's id: corruption, leave it for a human
      continue;
    }
    const modified = files.modifiedAt(rel);
    repo.insert({
      id: parsed.id,
      ownerUserId,
      jobId: job,
      stage: repo.lastStage(ownerUserId),
      source: "camera",
      takenAt: new Date(modified ?? now().getTime()).toISOString(),
      takenAtSource: "added_time",
      originalPath: rel,
      width: null,
      height: null,
      bytes: size,
      createdAt: now().toISOString(),
      recovered: true,
    });
    known.add(parsed.id);
    report.recovered += 1;
  }

  // 3. Previews without a photo.
  const tdir = thumbsDir(ownerUserId);
  for (const name of files.list(tdir)) {
    const id = name.replace(/\.jpg$/, "");
    if (!known.has(id) || name.endsWith(PART_SUFFIX)) {
      files.remove(`${tdir}/${name}`);
      report.thumbsRemoved += 1;
    }
  }
  return report;
}
