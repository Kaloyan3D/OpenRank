/**
 * OpenRank Design System v1 - rank color tokens (Phase 8.1).
 *
 * Rank colors are used ONLY where rank identity matters (badges, progress
 * fills, tier labels). They NEVER tint whole screens, and rank is never
 * communicated by color alone: tier text + division text always accompany
 * rank color. Tier names, divisions, thresholds and math are untouched.
 */

export const RANK_COLORS = {
  Bronze: "#C97A38",
  Iron: "#8B92A0",
  Gold: "#F5B82E",
  Platinum: "#60A5FA",
  Diamond: "#A78BFA",
  Titan: "#8B5CF6",
  Colossus: "#EC4899",
  Olympian: "#F43F5E",
  Mythic: "#FB7185",
} as const;

export type RankTierName = keyof typeof RANK_COLORS;

export const UNRANKED_COLOR = "#6B7280";

/**
 * Map an engine tier name to its semantic color token. Unknown/absent tier
 * names fall back to the neutral unranked gray - never an invented color.
 */
export function rankColor(tierName: string | null | undefined): string {
  if (tierName == null) return UNRANKED_COLOR;
  return (RANK_COLORS as Record<string, string>)[tierName] ?? UNRANKED_COLOR;
}
