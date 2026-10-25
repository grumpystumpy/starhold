import type { OfficerId, PlayerClassId } from "@starhold/game";
import {
  activateOfficerHire,
  buyShopItem,
  changeClass,
  chooseClass,
  claimDaily,
  claimGoalReward,
  raiseOfficerLevel,
  tradeResources,
  unlockSkillNode,
} from "./api";
import { clearFlash, schedulePaint, session, setFlash } from "./session";
import { settleMutation } from "./recover-action";

export async function doClaimDaily(): Promise<void> {
  if (!session.view || session.busy) return;
  session.busy = true;
  clearFlash();
  schedulePaint();
  try {
    session.view = await claimDaily(session.view.player.id);
    setFlash("notice", "Daily Starshards claimed.");
  } catch (err) {
    const before = session.view.player.lastDailyLoginUtc;
    await settleMutation({
      err,
      failureFallback: "Daily claim failed.",
      applied: (view) => view.player.lastDailyLoginUtc !== before,
      successNotice: () => "Daily Starshards claimed.",
    });
  } finally {
    session.busy = false;
    schedulePaint();
  }
}

export async function doBuyShopItem(
  itemId: string,
  targetPlanetId?: string,
): Promise<void> {
  if (!session.view || session.busy) return;
  const item = session.view.shopCatalog?.[itemId];
  const itemName = item?.name ?? "Shop item";
  session.busy = true;
  clearFlash();
  schedulePaint();
  try {
    session.view = await buyShopItem(
      session.view.player.id,
      itemId,
      targetPlanetId,
    );
    setFlash("notice", `${itemName} purchased.`);
  } catch (err) {
    await settleMutation({
      err,
      failureFallback: "Shop item purchase failed.",
      applied: () => false,
      successNotice: () => `${itemName} purchased.`,
    });
  } finally {
    session.busy = false;
    schedulePaint();
  }
}

export async function doClaimGoal(goalId: string): Promise<void> {
  if (!session.view || session.busy) return;
  const title =
    session.view.goals?.find((goal) => goal.id === goalId)?.title ?? "Goal";
  session.busy = true;
  clearFlash();
  schedulePaint();
  try {
    session.view = await claimGoalReward(session.view.player.id, goalId);
    setFlash("notice", `Claimed ${title}.`);
  } catch (err) {
    await settleMutation({
      err,
      failureFallback: "Goal claim failed.",
      applied: (view) => view.player.goals?.claimed.includes(goalId) ?? false,
      successNotice: () => `Claimed ${title}.`,
    });
  } finally {
    session.busy = false;
    schedulePaint();
  }
}

export async function doActivateOfficer(officerId: OfficerId): Promise<void> {
  if (!session.view || session.busy) return;
  const beforeLevel = session.view.officerLevels?.[officerId] ?? 0;
  const previousHire = session.view.officers.find(
    (officer) => officer.officerId === officerId,
  );
  const beforeActivatedAt = previousHire?.activatedAt;
  const beforeExpiresAt = previousHire?.expiresAt;
  session.busy = true;
  clearFlash();
  schedulePaint();
  try {
    session.view = await activateOfficerHire(
      session.view.player.id,
      officerId,
    );
    setFlash("notice", "Officer hired.");
  } catch (err) {
    await settleMutation({
      err,
      failureFallback: "Officer hire failed.",
      applied: (view) => {
        const hire = view.officers.find(
          (officer) => officer.officerId === officerId,
        );
        return (
          (view.officerLevels?.[officerId] ?? 0) > beforeLevel ||
          (hire !== undefined &&
            (hire.activatedAt !== beforeActivatedAt ||
              hire.expiresAt !== beforeExpiresAt))
        );
      },
      successNotice: () => "Officer hired.",
    });
  } finally {
    session.busy = false;
    schedulePaint();
  }
}

export async function doRaiseOfficer(officerId: OfficerId): Promise<void> {
  if (!session.view || session.busy) return;
  const beforeLevel = session.view.officerLevels?.[officerId] ?? 0;
  session.busy = true;
  clearFlash();
  schedulePaint();
  try {
    session.view = await raiseOfficerLevel(session.view.player.id, officerId);
    setFlash("notice", "Officer level raised.");
  } catch (err) {
    await settleMutation({
      err,
      failureFallback: "Could not raise officer level.",
      applied: (view) =>
        (view.officerLevels?.[officerId] ?? 0) > beforeLevel,
      successNotice: () => "Officer level raised.",
    });
  } finally {
    session.busy = false;
    schedulePaint();
  }
}

export async function doUnlockSkill(skillId: string): Promise<void> {
  if (!session.view || session.busy) return;
  const beforeLevel =
    session.view.skillLevels?.[skillId] ??
    (session.view.skillsUnlocked.includes(skillId) ? 1 : 0);
  const wasUnlocked = session.view.skillsUnlocked.includes(skillId);
  session.busy = true;
  clearFlash();
  schedulePaint();
  try {
    session.view = await unlockSkillNode(session.view.player.id, skillId);
    setFlash("notice", "Skill unlocked.");
  } catch (err) {
    await settleMutation({
      err,
      failureFallback: "Skill unlock failed.",
      applied: (view) =>
        (view.skillLevels?.[skillId] ?? 0) > beforeLevel ||
        (!wasUnlocked && view.skillsUnlocked.includes(skillId)),
      successNotice: () => "Skill unlocked.",
    });
  } finally {
    session.busy = false;
    schedulePaint();
  }
}

export async function doTradeResources(
  direction: "buy" | "sell",
): Promise<void> {
  if (!session.view || session.busy) return;
  const beforeStarshards = session.view.starshards ?? 0;
  session.busy = true;
  clearFlash();
  schedulePaint();
  try {
    session.view = await tradeResources(
      session.view.player.id,
      session.view.planet.id,
      direction,
    );
    setFlash(
      "notice",
      direction === "buy"
        ? "Resource bundle purchased."
        : "Resource bundle sold for Starshards.",
    );
  } catch (err) {
    await settleMutation({
      err,
      failureFallback: "Resource trade failed.",
      applied: (view) =>
        (view.starshards ?? 0) ===
        beforeStarshards + (direction === "sell" ? 1500 : -1500),
      successNotice: () =>
        direction === "buy"
          ? "Resource bundle purchased."
          : "Resource bundle sold for Starshards.",
    });
  } finally {
    session.busy = false;
    schedulePaint();
  }
}

export async function doChooseClass(classId: PlayerClassId): Promise<void> {
  if (!session.view || session.busy) return;
  session.busy = true;
  clearFlash();
  schedulePaint();
  try {
    session.view = await chooseClass(session.view.player.id, classId);
    setFlash("notice", "Class chosen.");
  } catch (err) {
    await settleMutation({
      err,
      failureFallback: "Class choose failed.",
      applied: (view) => view.player.playerClass?.classId === classId,
      successNotice: () => "Class chosen.",
    });
  } finally {
    session.busy = false;
    schedulePaint();
  }
}

export async function doChangeClass(classId: PlayerClassId): Promise<void> {
  if (!session.view || session.busy) return;
  session.busy = true;
  clearFlash();
  schedulePaint();
  try {
    session.view = await changeClass(session.view.player.id, classId);
    setFlash("notice", "Class changed.");
  } catch (err) {
    await settleMutation({
      err,
      failureFallback: "Class change failed.",
      applied: (view) => view.player.playerClass?.classId === classId,
      successNotice: () => "Class changed.",
    });
  } finally {
    session.busy = false;
    schedulePaint();
  }
}
