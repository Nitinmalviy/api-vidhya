/**
 * "My Locker" entitlements — how much vault space each paid plan buys.
 *
 * The locker is a paid feature: only a patient with a live PREMIUM cycle can
 * add members or upload reports. FREE patients can still read whatever is
 * already in their locker, so nothing disappears when a plan lapses.
 *
 * Keep in sync with the web app's `lib/locker.ts` and the patient mobile
 * app's `src/constants/locker.ts`.
 */

/** Reports one person (locker member) may hold. Same for every paid plan. */
export const REPORTS_PER_MEMBER = 5;

export type LockerEntitlement = {
  /** People the locker can hold, including the account owner. */
  maxMembers: number;
  /** Reports allowed per member. */
  reportsPerMember: number;
};

/**
 * planId → entitlement. ₹149 "single" covers the account holder only; "family"
 * covers 5 people *including* the account holder.
 */
export const LOCKER_ENTITLEMENTS: Record<string, LockerEntitlement> = {
  single: { maxMembers: 1, reportsPerMember: REPORTS_PER_MEMBER },
  family: { maxMembers: 5, reportsPerMember: REPORTS_PER_MEMBER },
};

/** Entitlement for a plan that has no locker (FREE / lapsed / unknown planId). */
export const NO_LOCKER: LockerEntitlement = { maxMembers: 0, reportsPerMember: 0 };

export function entitlementFor(planId: string | null | undefined): LockerEntitlement {
  if (!planId) return NO_LOCKER;
  return LOCKER_ENTITLEMENTS[planId] ?? NO_LOCKER;
}
