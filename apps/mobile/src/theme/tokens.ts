/**
 * LEGACY token shim (Phase 8.1): the approved design system now lives in
 * src/design. This shim maps the old token names onto the new semantic
 * palette so un-migrated screens render the approved colors immediately.
 * New code imports from src/design directly.
 */
import { colors as designColors } from "../design/colors";
import { space as designSpace } from "../design/spacing";
import { type as designType } from "../design/typography";

export const colors = {
  background: designColors.bg,
  surface: designColors.surface,
  text: designColors.text,
  textMuted: designColors.textMuted,
  accent: designColors.accent,
  success: designColors.success,
} as const;

export const spacing = {
  xs: designSpace.xs,
  sm: designSpace.sm,
  md: designSpace.lg,
  lg: designSpace.xxl,
  xl: 32,
} as const;

export const typography = {
  title: { ...designType.sectionTitle },
  body: { ...designType.body },
  caption: { ...designType.caption, color: designColors.textMuted },
} as const;
