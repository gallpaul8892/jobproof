import type { LocalDb } from "./localDb";
import type { UnsentItemsSource, UnsentSummary } from "../features/session/unsent";

/**
 * The real sign-out count (T-003b scenario 9), read from the phone's database for ONE user:
 *  - photos: live photos that have not reached the office (anything but `sent`);
 *  - reports: jobs with a changed draft, changed checklist, or a submit still queued.
 * A photo the operative deleted does not count (nothing is waiting to be sent for it).
 */
export class SqliteUnsentItemsSource implements UnsentItemsSource {
  constructor(private readonly db: LocalDb) {}

  summaryFor(userId: string): UnsentSummary {
    const photos = this.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM photos WHERE owner_user_id = ? AND deleted = 0 AND sync_state <> 'sent'", [userId])?.n ?? 0;
    const reports =
      this.db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM (
           SELECT job_id FROM drafts
            WHERE owner_user_id = ?1
              AND (notes_rev > notes_synced_rev OR sign_off_rev > sign_off_synced_rev OR local_state = 'submit_queued')
           UNION
           SELECT job_id FROM checklist_states WHERE owner_user_id = ?1 AND rev > synced_rev
         )`,
        [userId],
      )?.n ?? 0;
    return { photos, reports };
  }
}
