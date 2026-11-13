import {
  CURRENT_RELEASE_ID,
  isVacationMode,
  quoteResourceMerchant,
  type OfficerId,
  type PlayerClassId,
} from "@starhold/game";
import {
  activateOfficerHire,
  buyShopItem,
  changeClass,
  chooseClass,
  claimDaily,
  claimGoalReward,
  claimOnboarding,
  dismissMidgameBriefing,
  dismissOnboarding,
  dismissWhatsNew,
  setVacationMode,
  raiseOfficerLevel,
  tradeResources,
  tradeWithMerchant,
  unlockSkillNode,
} from "./api";
import { clearFlash, schedulePaint, session, setFlash } from "./session";
import { settleMutation } from "./recover-action";

function releaseActionFocus(): void {
  const active = globalThis.document?.activeElement;
  if (typeof HTMLElement === "undefined") return;
  if (active instanceof HTMLElement) active.blur();
}

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
  const beforeStarshards = session.view.starshards ?? 0;
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
      applied: (view) => (view.starshards ?? 0) < beforeStarshards,
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

export async function doClaimOnboarding(stepId: string): Promise<void> {
  if (!session.view || session.busy) return;
  const title =
    session.view.onboarding?.steps.find((step) => step.id === stepId)?.title ??
    "Briefing";
  session.busy = true;
  clearFlash();
  schedulePaint();
  try {
    session.view = await claimOnboarding(session.view.player.id, stepId);
    setFlash("notice", `Claimed ${title}.`);
  } catch (err) {
    await settleMutation({
      err,
      failureFallback: "Briefing claim failed.",
      applied: (view) => view.player.onboarding?.claimed?.includes(stepId) ?? false,
      successNotice: () => `Claimed ${title}.`,
    });
  } finally {
    session.busy = false;
    releaseActionFocus();
    schedulePaint();
  }
}

export async function doSetVacationMode(enabled: boolean): Promise<void> {
  if (!session.view || session.busy) return;
  session.busy = true;
  clearFlash();
  schedulePaint();
  try {
    session.view = await setVacationMode(session.view.player.id, enabled);
    setFlash(
      "notice",
      enabled ? "Vacation mode is on." : "Vacation mode is off.",
    );
  } catch (err) {
    await settleMutation({
      err,
      failureFallback: "Couldn't change vacation mode.",
      applied: (view) => isVacationMode(view.player) === enabled,
      successNotice: () =>
        enabled ? "Vacation mode is on." : "Vacation mode is off.",
    });
  } finally {
    session.busy = false;
    releaseActionFocus();
    schedulePaint();
  }
}

export async function doDismissWhatsNew(): Promise<void> {
  if (!session.view || session.busy) return;
  session.busy = true;
  clearFlash();
  schedulePaint();
  try {
    session.view = await dismissWhatsNew(session.view.player.id);
    setFlash("notice", "What's new hidden.");
  } catch (err) {
    await settleMutation({
      err,
      failureFallback: "Couldn't hide what's new.",
      applied: (view) =>
        view.player.whatsNewDismissedReleaseId === CURRENT_RELEASE_ID,
      successNotice: () => "What's new hidden.",
    });
  } finally {
    session.busy = false;
    releaseActionFocus();
    schedulePaint();
  }
}

export async function doDismissOnboarding(dismissed: boolean): Promise<void> {
  if (!session.view || session.busy) return;
  session.busy = true;
  clearFlash();
  schedulePaint();
  try {
    session.view = await dismissOnboarding(session.view.player.id, dismissed);
    setFlash("notice", dismissed ? "Tutorial hidden." : "Tutorial restored.");
  } catch (err) {
    await settleMutation({
      err,
      failureFallback: "Tutorial update failed.",
      applied: (view) => Boolean(view.onboarding?.dismissed) === dismissed,
      successNotice: () => dismissed ? "Tutorial hidden." : "Tutorial restored.",
    });
  } finally {
    session.busy = false;
    releaseActionFocus();
    schedulePaint();
  }
}

export async function doDismissMidgameBriefing(dismissed: boolean): Promise<void> {
  if (!session.view || session.busy) return;
  session.busy = true;
  clearFlash();
  schedulePaint();
  try {
    session.view = await dismissMidgameBriefing(session.view.player.id, dismissed);
    setFlash("notice", dismissed ? "Milestones hidden." : "Milestones restored.");
  } catch (err) {
    await settleMutation({
      err,
      failureFallback: "Milestone update failed.",
      applied: (view) => Boolean(view.player.midgameBriefingDismissed) === dismissed,
      successNotice: () => dismissed ? "Milestones hidden." : "Milestones restored.",
    });
  } finally {
    session.busy = false;
    releaseActionFocus();
    schedulePaint();
  }
}

export async function doActivateOfficer(
  officerId: OfficerId,
  hours?: number,
): Promise<void> {
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
      hours,
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

export async function doMerchantTrade(
  give: "metal" | "crystal" | "deuterium",
  get: "metal" | "crystal" | "deuterium",
  amount: number,
): Promise<void> {
  if (!session.view || session.busy) return;
  const planetId = session.view.planet.id;
  const before = { ...session.view.planet.resources };
  const beforeShards = session.view.starshards ?? 0;
  const quote = quoteResourceMerchant(give, get, amount);
  const delivered = quote.ok ? quote.output : 0;
  releaseActionFocus();
  session.busy = true;
  clearFlash();
  schedulePaint();
  try {
    session.view = await tradeWithMerchant(
      session.view.player.id,
      planetId,
      give,
      get,
      amount,
    );
    setFlash("notice", `Merchant delivered ${delivered} ${get}.`);
  } catch (err) {
    await settleMutation({
      err,
      failureFallback: "Resource trade failed.",
      applied: (view) =>
        view.planet.id === planetId &&
        quote.ok &&
        view.planet.resources[get] >= before[get] + delivered &&
        (view.starshards ?? 0) >= beforeShards,
      successNotice: () => `Merchant delivered ${delivered} ${get}.`,
    });
  } finally {
    session.busy = false;
    releaseActionFocus();
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
