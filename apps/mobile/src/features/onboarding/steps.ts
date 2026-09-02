import type { OnboardingStep } from "@openrank/database";

/** Durable step -> route. The resume route derives from the DB, not React. */
export const STEP_ROUTES: Record<OnboardingStep, string> = {
  welcome: "/onboarding",
  profile_name: "/onboarding/name",
  units: "/onboarding/units",
  strength_standard: "/onboarding/standard",
  bodyweight: "/onboarding/bodyweight",
  training_days: "/onboarding/days",
  plan_review: "/onboarding/review",
  reminders: "/onboarding/reminders",
  ready: "/onboarding/ready",
};

export function routeForStep(step: OnboardingStep): string {
  return STEP_ROUTES[step];
}
