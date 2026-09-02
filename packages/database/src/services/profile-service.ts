import type { BodyweightEntry, BodyweightRepository, Profile, ProfileRepository } from "@openrank/domain";
import type { DatabaseDriver } from "../driver";

/**
 * ProfileService (Phase 7.1): the local-profile lifecycle.
 *
 * OpenRank v1 is account-free and supports exactly ONE active local profile.
 * The profile is a LOCAL DOMAIN PROFILE in SQLite; a future remote account
 * must BIND to it - never replace it, and logging out of any future account
 * must never imply deleting local workout history.
 *
 * Single-profile semantics (deliberate, documented, deterministic):
 * - no profile            -> create one (status "created")
 * - incomplete profile    -> resume/reuse it (status "reused"); the display
 *                            name and step are refreshed, nothing duplicated
 * - completed profile     -> structured conflict (status "conflict") carrying
 *                            the existing profile; callers route to the main
 *                            app instead of creating a second default profile
 *
 * Onboarding steps are a fixed ladder; setOnboardingStep validates against
 * it so the durable pointer can never name an unknown screen.
 */

export const ONBOARDING_STEPS = [
  "welcome",
  "profile_name",
  "units",
  "strength_standard",
  "bodyweight",
  "training_days",
  "plan_review",
  "reminders",
  "ready",
] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/** Deterministic root-routing decision (spec: the root gate owns the invariant). */
export function resolveRootRoute(profile: Profile | null): "/onboarding" | "/onboarding/resume" | "/(tabs)" {
  if (!profile) return "/onboarding";
  return profile.onboardingCompleted ? "/(tabs)" : "/onboarding/resume";
}

/**
 * Deterministic resume step for an incomplete profile. Trusts the persisted
 * pointer first; the fallback covers a profile row that was created but died
 * before its first step write (the name step creates the profile, so the
 * units step is always a safe resume point).
 */
export function resolveResumeStep(profile: Profile): OnboardingStep {
  const step = profile.onboardingStep;
  if (step && (ONBOARDING_STEPS as readonly string[]).includes(step)) {
    return step as OnboardingStep;
  }
  return "units";
}

export interface LocalProfileInput {
  displayName: string;
}

export type LocalProfileResult =
  | { status: "created"; profile: Profile }
  | { status: "reused"; profile: Profile }
  | { status: "conflict"; profile: Profile };

export interface ProfileServiceDeps {
  profile: ProfileRepository;
  bodyweight: BodyweightRepository;
}

const DISPLAY_NAME_MAX_CODEPOINTS = 40;
/** Source tag of the single measurement created by the onboarding flow. */
export const ONBOARDING_BODYWEIGHT_SOURCE = "onboarding";

export class ProfileService {
  constructor(
    private readonly driver: DatabaseDriver,
    private readonly deps: ProfileServiceDeps,
  ) {}

  /** The single local profile, or null on a fresh installation. */
  getDefaultProfile(): Profile | null {
    return this.deps.profile.getDefault();
  }

  /**
   * Create (or resume) the local profile for a first-launch display name.
   * See the class doc for the three documented outcomes. The name is
   * trimmed, must be non-empty, is capped at 40 Unicode code points and is
   * stored verbatim otherwise (no case folding, no normalization games -
   * display text is user identity, not a key).
   */
  createLocalProfile(input: LocalProfileInput): LocalProfileResult {
    const displayName = validateDisplayName(input.displayName);
    return this.driver.transaction(() => {
      const existing = this.deps.profile.getDefault();
      if (existing && existing.onboardingCompleted) {
        return { status: "conflict" as const, profile: existing };
      }
      if (existing) {
        // Resume/reuse: refresh the name the user just chose and continue
        // the SAME onboarding - never a second default profile.
        if (existing.displayName !== displayName) {
          this.deps.profile.updateDisplayName(existing.id, displayName);
        }
        this.setOnboardingStep(existing.id, "units");
        return { status: "reused" as const, profile: this.deps.profile.getDefault()! };
      }
      const created = this.deps.profile.ensureDefault();
      this.deps.profile.updateDisplayName(created.id, displayName);
      this.setOnboardingStep(created.id, "units");
      return { status: "created" as const, profile: this.deps.profile.getDefault()! };
    });
  }

  updateDisplayName(profileId: string, displayName: string): Profile {
    const name = validateDisplayName(displayName);
    this.deps.profile.updateDisplayName(profileId, name);
    return this.deps.profile.getDefault()!;
  }

  updateUnitSystem(profileId: string, unitSystem: "metric" | "imperial"): Profile {
    this.deps.profile.updateUnitSystem(profileId, unitSystem);
    return this.deps.profile.getDefault()!;
  }

  /** Ranking reference only - selects thresholds, never identity. */
  updateStrengthStandard(profileId: string, standard: "male" | "female"): Profile {
    this.deps.profile.updateStrengthStandard(profileId, standard);
    return this.deps.profile.getDefault()!;
  }

  setOnboardingStep(profileId: string, step: OnboardingStep): void {
    if (!(ONBOARDING_STEPS as readonly string[]).includes(step)) {
      throw new Error("unknown onboarding step: " + step);
    }
    this.deps.profile.setOnboardingStep(profileId, step);
  }

  /**
   * THE only transition that unlocks the main app. Idempotent; clears the
   * step pointer (onboarding state becomes history).
   */
  completeOnboarding(profileId: string): Profile {
    return this.driver.transaction(() => {
      this.deps.profile.completeOnboarding(profileId);
      return this.deps.profile.getDefault()!;
    });
  }

  /**
   * Deterministic onboarding bodyweight semantics (spec: one intentional
   * onboarding measurement != accidental history). The measurement created
   * by onboarding is UPDATED in place on re-entry/back-navigation; skip
   * stores nothing (no placeholder data, no assumed weight).
   */
  setOnboardingBodyweight(profileId: string, weightKg: number | null, nowUtc: string): BodyweightEntry | null {
    if (weightKg == null) return null;
    if (!(weightKg > 0) || !Number.isFinite(weightKg)) {
      throw new Error("bodyweight must be a positive finite number of kilograms");
    }
    return this.driver.transaction(() => {
      const existing = this.getOnboardingBodyweight(profileId);
      if (existing) {
        this.deps.bodyweight.updateWeight(existing.id, weightKg);
        return this.deps.bodyweight.history(profileId).find((e) => e.id === existing.id) ?? null;
      }
      return this.deps.bodyweight.add({
        profileId,
        measuredAt: nowUtc,
        weightKg: Math.round(weightKg * 1000) / 1000,
        source: ONBOARDING_BODYWEIGHT_SOURCE,
        note: null,
      });
    });
  }

  /** The single onboarding-created measurement, if one exists. */
  getOnboardingBodyweight(profileId: string): BodyweightEntry | null {
    return (
      this.deps.bodyweight
        .history(profileId)
        .find((e) => e.source === ONBOARDING_BODYWEIGHT_SOURCE) ?? null
    );
  }
}

function validateDisplayName(raw: string): string {
  const name = raw.trim();
  if (name.length === 0) throw new Error("display name must not be empty");
  // Count code points, not UTF-16 units, so emoji/astral names cap fairly.
  if ([...name].length > DISPLAY_NAME_MAX_CODEPOINTS) {
    throw new Error("display name is too long (max " + String(DISPLAY_NAME_MAX_CODEPOINTS) + " characters)");
  }
  return name;
}
