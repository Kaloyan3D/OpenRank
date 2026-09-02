/**
 * Adapters from the bundled catalog to the canonical domain model.
 */
import type { Exercise, Muscle } from "@openrank/domain";
import type { CatalogExercise, CatalogMuscle, CatalogV1 } from "./schema";

/** Map a catalog exercise onto the domain model (muscles are relational). */
export function toDomainExercise(ex: CatalogExercise): Exercise {
  return {
    id: ex.id,
    slug: ex.slug,
    name: ex.name,
    category: ex.category,
    mechanic: ex.mechanic,
    force: ex.force,
    equipment: ex.equipment,
    trackingType: ex.trackingType,
    isCustom: ex.isCustom,
    source: ex.source,
    sourceId: ex.sourceId,
  };
}

/** Map the catalog muscle taxonomy onto the domain model. */
export function toDomainMuscles(catalog: CatalogV1): Muscle[] {
  return catalog.muscles.map((m: CatalogMuscle) => ({
    id: m.id,
    name: m.name,
    majorGroup: m.majorGroup,
  }));
}