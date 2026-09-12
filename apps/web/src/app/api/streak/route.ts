import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getStreakSnapshot } from "@/lib/streak";

/**
 * GET /api/streak
 *
 * Authoritative activity snapshot for the signed-in user: the current streak
 * plus today's contribution counts. Every live streak/heatmap display refreshes
 * itself from here after the user records activity, instead of estimating the
 * new value in the browser — the estimates drifted from the server in both
 * directions (see `lib/streak.ts`).
 *
 * `streak` is `null` for signed-out users, the same contract the navbar uses.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ streak: null, todayCount: 0, todayDsaCount: 0 }, { status: 401 });
  }

  const snapshot = await getStreakSnapshot(user.id);
  return NextResponse.json(
    snapshot ?? { streak: null, todayCount: 0, todayDsaCount: 0 }
  );
}
