/**
 * What happens to this phone's shared walls when the signed-in account, or
 * the server, changes. Pure, so the rules can be tested in Node.
 */
import type { Wall } from "./wall";

export interface Account {
  id: string;
  email: string;
  /** Missing on accounts saved before builds could point at other servers. */
  server?: string;
}

export interface AccountChange {
  /** Walls that become this phone's own, with everything on them. */
  unshare: string[];
  /** Walls that come off this phone; they stay on their server. */
  drop: string[];
  /** The account to record, or null when nothing has changed. */
  record: Account | null;
}

/**
 * Shared walls belong to the account that joined them. A different account
 * signing in drops the previous one's — they stay on the server — so its
 * queued changes can never go up under the new one.
 *
 * A different server is another matter: the old walls are out of reach
 * there, so walls the phone owns stay, as its own again, ready to share on
 * the new one. Joined walls go.
 */
export function accountChange(
  previous: Account | null,
  me: { id: string; email: string },
  server: string,
  walls: readonly Pick<Wall, "id" | "cloud" | "role">[],
): AccountChange {
  if (previous?.id === me.id && previous.server === server) return { unshare: [], drop: [], record: null };

  const record = { id: me.id, email: me.email, server };
  /* First sign-in on this phone, or the same account on an older record. */
  if (!previous || (previous.id === me.id && (previous.server ?? server) === server)) {
    return { unshare: [], drop: [], record };
  }

  const sameServer = (previous.server ?? server) === server;
  const shared = walls.filter((w) => w.cloud);
  const kept = sameServer ? [] : shared.filter((w) => w.role === "owner");
  return {
    unshare: kept.map((w) => w.id),
    drop: shared.filter((w) => !kept.includes(w)).map((w) => w.id),
    record,
  };
}
