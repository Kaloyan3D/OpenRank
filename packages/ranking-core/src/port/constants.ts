/**
 * Ranking constants - a faithful transcription of the legacy Hevy Ranks
 * engine's data tables (packages/ranking-core/src/legacy/engine.js).
 *
 * DO NOT "improve" values here: thresholds, coefficients, weights and caps
 * are frozen under ranking version "hevy-ranks-compatible-v1". Keyword lists
 * must keep their exact order (most specific patterns first) and their
 * exact strings, including intentional duplicates, trailing spaces and
 * accentless forms - matching is a plain substring `includes()` against a
 * deburred title, so these details are load-bearing.
 */
import type { GroupConfig, GroupKey, RankTier } from "./types.js";

/** Minimum number of distinct sessions for an exercise to count in the rank. */
export const MIN_SESSIONS = 3;

/** Decreasing weights used for the composite aggregation (top 3 compounds). */
export const COMPOSITE_WEIGHTS = [1.0, 0.5, 0.25];

/** Max tier reachable via isolation lifts only (index in RANK_TIERS). */
export const ISOLATION_TIER_CAP = 5; // Titan

/** Max tier when no exercise reaches MIN_SESSIONS (very partial data). */
export const FEW_SESSIONS_TIER_CAP = 3; // Platinum

/** The 9 ranks, from lowest to highest, with their emblem and color. */
export const RANK_TIERS: readonly RankTier[] = [
  { name: "Bronze", img: "rank-01-bronze.png", color: "#c07a3e" },
  { name: "Iron", img: "rank-02-iron.png", color: "#9aa1ab" },
  { name: "Gold", img: "rank-03-gold.png", color: "#e8b923" },
  { name: "Platinum", img: "rank-04-platinum.png", color: "#d3dae1" },
  { name: "Diamond", img: "rank-05-diamond.png", color: "#5ec8ff" },
  { name: "Titan", img: "rank-06-titan.png", color: "#2fe0c8" },
  { name: "Colossus", img: "rank-07-colossus.png", color: "#ff6a2b" },
  { name: "Olympian", img: "rank-08-olympian.png", color: "#ffd76a" },
  { name: "Mythic", img: "rank-09-mythic.png", color: "#c07cff" },
];

/**
 * Configuration per muscle group.
 * - primaries : Hevy `primary_muscle_group` values mapped to the group
 * - ref       : reference lift (coeff = 1.0)
 * - thresholds: 9 thresholds "reference 1RM equivalent / bodyweight" (index = tier)
 * - def       : default coefficient for an exercise not listed in the group
 * Male standards; multiplied by ~0.72 when sex = female.
 */
export const GROUPS: Record<GroupKey, GroupConfig> = {
  legs: {
    key: "legs",
    label: "Legs",
    ref: "Squat",
    primaries: ["quadriceps", "hamstrings", "glutes", "calves", "abductors", "adductors"],
    thresholds: [0, 0.5, 0.75, 1.0, 1.25, 1.5, 1.85, 2.3, 3.0],
    def: 1.3,
  },
  chest: {
    key: "chest",
    label: "Chest",
    ref: "Bench press",
    primaries: ["chest"],
    thresholds: [0, 0.4, 0.6, 0.8, 1.0, 1.25, 1.55, 1.9, 2.4],
    def: 1.1,
  },
  back: {
    key: "back",
    label: "Back",
    ref: "Barbell row",
    primaries: ["lats", "upper_back", "lower_back", "traps"],
    thresholds: [0, 0.4, 0.6, 0.8, 1.0, 1.25, 1.55, 1.9, 2.3],
    def: 1.1,
  },
  shoulders: {
    key: "shoulders",
    label: "Shoulders",
    ref: "Overhead press",
    primaries: ["shoulders", "neck"],
    thresholds: [0, 0.3, 0.4, 0.55, 0.7, 0.85, 1.05, 1.3, 1.6],
    def: 1.0,
  },
  arms: {
    key: "arms",
    label: "Arms",
    ref: "Barbell curl",
    primaries: ["biceps", "triceps", "forearms"],
    thresholds: [0, 0.25, 0.35, 0.45, 0.55, 0.7, 0.85, 1.05, 1.3],
    def: 1.0,
  },
  core: {
    key: "core",
    label: "Core",
    ref: "Weighted crunch",
    primaries: ["abdominals"],
    thresholds: [0, 0.15, 0.25, 0.35, 0.45, 0.6, 0.8, 1.05, 1.4],
    def: 1.0,
  },
};

/** Hevy `primary_muscle_group` -> major group key. */
export const PRIMARY_TO_GROUP: Record<string, GroupKey> = (() => {
  const m: Record<string, GroupKey> = {};
  for (const g of Object.values(GROUPS)) {
    for (const p of g.primaries) m[p] = g.key;
  }
  return m;
})();

/**
 * Per-exercise coefficients, per group (coeff = exercise 1RM / reference 1RM).
 * Most specific patterns first. An exercise with no match uses `def`.
 * Keywords in multiple languages, written WITHOUT accents (titles are
 * deburred before comparison).
 */
export interface CoeffEntry {
  k: string[];
  c: number;
  isolation?: boolean;
}

export const GROUP_COEFFS: Record<GroupKey, CoeffEntry[]> = {
  legs: [
    // Squat variants
    { k: ["front squat", "squat avant", "sentadilla frontal", "frontkniebeuge", "agachamento frontal", "squat frontale"], c: 0.85 },
    { k: ["hack squat", "hack"], c: 1.35 },
    { k: ["pendulum", "pendule"], c: 1.4 },
    { k: ["box squat"], c: 0.95 },
    { k: ["split squat", "bulgarian", "bulgare", "sentadilla bulgara", "bulgarische kniebeuge", "agachamento bulgaro", "squat bulgaro"], c: 0.5 },
    { k: ["goblet"], c: 0.5 },
    { k: ["sissy"], c: 0.5, isolation: true },
    { k: ["belt squat"], c: 1.4 },
    // Press machines
    { k: ["leg press", "presse a cuisses", "presse cuisses", "presse", "prensa", "beinpresse", "pressa gambe", "pressa"], c: 3.0 },
    // Hinge
    { k: ["romanian", "rdl", "roumain", "rumano", "rumeno", "rumano"], c: 1.05 },
    { k: ["stiff", "jambes tendues", "gestreckt"], c: 1.0 },
    { k: ["good morning"], c: 0.75 },
    { k: ["deadlift", "souleve de terre", "peso muerto", "kreuzheben", "levantamento terra", "stacco"], c: 1.2 },
    // Glutes
    { k: ["hip thrust", "poussee de hanche", "empuje de cadera", "huftheben", "elevacao de quadril", "spinta anca"], c: 1.6 },
    { k: ["glute bridge", "pont fessier", "puente gluteo", "brucke", "ponte gluteo"], c: 1.4 },
    { k: ["cable pull through", "pull through", "pull-through"], c: 0.9 },
    // Isolation
    { k: ["leg extension", "extension des jambes", "extension jambes", "leg extensions", "beinstrecker", "estensione gambe", "extension cuadriceps"], c: 0.9, isolation: true },
    { k: ["leg curl", "curl ischio", "ischio", "leg curls", "hamstring curl", "beinbeuger", "flessione gambe", "curl femoral"], c: 0.8, isolation: true },
    { k: ["calf", "mollet", "pantorrilla", "wade", "panturrilha", "polpaccio"], c: 2.8, isolation: true },
    { k: ["adductor", "abductor", "adducteur", "abducteur", "aductor", "abductor"], c: 0.7, isolation: true },
    // Lunges / unilateral
    { k: ["lunge", "fente", "zancada", "ausfallschritt", "afundo", "affondo"], c: 0.5 },
    { k: ["step up", "step-up", "montee de banc"], c: 0.5 },
    // Generic squat (must be LAST because everything above is a squat variant)
    { k: ["squat", "sentadilla", "kniebeuge", "agachamento"], c: 1.0 },
  ],
  chest: [
    // Angle variants (must come first - a title like `Incline Bench Press`
    // should get the incline coeff, not the generic bench coeff).
    { k: ["incline", "incliné", "inclinado", "schrag", "inclinada", "inclinata"], c: 0.85 },
    { k: ["decline", "decliné", "declinado", "abfallend", "declinada", "declinata"], c: 1.0 },
    // Isolation
    { k: ["ecarte", "fly", "flye", "pec deck", "pec dec", "butterfly", "apertura", "aperture", "kurzhantel fly", "abertura", "croce"], c: 0.8, isolation: true },
    { k: ["cable crossover", "crossover"], c: 0.7, isolation: true },
    // Machines
    { k: ["chest press", "machine", "prensa pecho"], c: 1.2 },
    // Dumbbell vs barbell
    { k: ["dumbbell", "haltere", "db ", "mancuerna", "kurzhantel", "halter", "manubri"], c: 0.9 },
    // Dips (chest-oriented)
    { k: ["dips", "dip"], c: 1.1 },
    // Bodyweight
    { k: ["push up", "pushup", "push-up", "pompe", "flexion pecho", "liegestutz", "flessione", "flexao"], c: 0.6 },
    // Generic press (LAST)
    { k: ["bench press", "developpe couche", "developpe", "bench", "press banca", "prensa banca", "bankdruck", "supino", "panca"], c: 1.0 },
  ],
  back: [
    // Deadlift (some users log it under back)
    { k: ["deadlift", "souleve de terre", "peso muerto", "kreuzheben", "levantamento terra", "stacco"], c: 1.4 },
    // Row variants
    { k: ["pendlay"], c: 1.0 },
    { k: ["meadows"], c: 0.8 },
    { k: ["t-bar", "t bar", "tbar"], c: 1.1 },
    { k: ["chest supported", "chest-supported"], c: 0.8 },
    { k: ["seated", "assis", "cable row", "tirage poulie", "rowing poulie", "tirage horizontal", "sentado", "sitzend", "sentado", "seduto"], c: 1.1 },
    // Pulldown
    { k: ["lat pulldown", "pulldown", "tirage vertical", "tirage nuque", "tirage", "jalon", "latzug", "puxada", "lat machine"], c: 1.0 },
    // Pull-up family
    { k: ["pull up", "pull-up", "pullup", "chin", "traction", "dominada", "klimmzug", "barra fixa", "trazion", "muscle up"], c: 0.9 },
    // Single-arm row
    { k: ["dumbbell row", "one arm", "single arm", "rowing haltere", "unilateral", "einarmig", "una mano"], c: 0.5 },
    // Lower back / erector
    { k: ["back extension", "hyperextension", "hyper extension", "lombaires", "extension lombaire", "iperestensione", "reverse hyper"], c: 2.0, isolation: true },
    // Traps
    { k: ["shrug", "haussement", "shrugs", "encogimiento", "nackenheben", "encolhimento", "scrollata"], c: 1.9, isolation: true },
    // Generic row (LAST)
    { k: ["row", "rowing", "rudern", "remo", "remada", "rematore", "vogatore"], c: 1.0 },
  ],
  shoulders: [
    { k: ["push press"], c: 1.2 },
    { k: ["arnold"], c: 0.8 },
    { k: ["landmine"], c: 0.85 },
    // Isolation raises
    { k: ["lateral raise", "side raise", "elevation laterale", "laterale", "elevations laterales", "elevacion lateral", "seitheben", "elevacao lateral", "alzata laterale"], c: 0.5, isolation: true },
    { k: ["front raise", "elevation frontale", "frontale", "elevacion frontal", "frontheben", "elevacao frontal", "alzata frontale"], c: 0.5, isolation: true },
    { k: ["rear delt", "face pull", "reverse fly", "oiseau", "posterior fly", "hinterer"], c: 0.55, isolation: true },
    { k: ["upright row", "tirage menton", "rowing menton", "remo al menton", "aufrechtes rudern", "remada alta", "tirata al mento"], c: 0.6 },
    // Dumbbell OHP variant
    { k: ["dumbbell", "haltere", "db ", "mancuerna", "kurzhantel", "manubri"], c: 0.85 },
    // Generic press (LAST)
    { k: ["overhead", "military", "shoulder press", "ohp", "militaire", "developpe epaules", "developpe", "press", "press militar", "press hombro", "schulterdrucken", "schulterpresse", "desenvolvimento", "pressa spalle"], c: 1.0 },
  ],
  arms: [
    // Machine dips
    { k: ["machine dip", "dips assis", "dips machine", "dip machine", "seated dip"], c: 2.6 },
    // Close-grip bench (tricep-dominant)
    { k: ["close grip", "close-grip", "prise serree", "agarre cerrado", "enge griff", "presa stretta"], c: 1.6 },
    // Tricep isolation
    { k: ["skull", "lying tricep", "lying triceps", "french", "barre au front", "trizeps druck"], c: 0.7, isolation: true },
    // "corda" is safe here - the group is already known to be arms, so
    // jump rope / other unrelated matches are filtered out upstream.
    { k: ["pushdown", "push down", "pressdown", "poulie triceps", "corda triceps", "triceps na corda", "corda", "triceps polea", "trizepsdrucken"], c: 1.9, isolation: true },
    { k: ["overhead tricep", "overhead extension", "extension nuque", "extension au dessus"], c: 0.6, isolation: true },
    { k: ["extension triceps", "triceps", "trizeps", "tricipite"], c: 2.2, isolation: true },
    { k: ["dips", "dip"], c: 1.3 },
    // Bicep isolation
    { k: ["preacher", "pupitre", "predicador", "scott curl"], c: 0.85, isolation: true },
    { k: ["hammer", "marteau", "martillo", "hammercurl"], c: 0.9, isolation: true },
    { k: ["concentration"], c: 0.55, isolation: true },
    { k: ["spider curl", "drag curl", "zottman", "21s"], c: 0.85, isolation: true },
    { k: ["ez", "ez-bar", "ez bar", "barre ez"], c: 0.95, isolation: true },
    { k: ["dumbbell curl", "db curl", "curl haltere", "curl con manubri", "kurzhantel curl", "rosca alterna"], c: 0.85, isolation: true },
    // Forearms
    { k: ["wrist", "forearm", "avant-bras", "avant bras", "poignet", "reverse curl", "curl inverse", "curl invertido", "avambraccio", "unterarm", "antebraco", "antebrazo"], c: 0.6, isolation: true },
    { k: ["farmer"], c: 1.0 },
    // Generic bicep curl (LAST)
    { k: ["curl", "rosca", "riccio", "bizepscurl"], c: 1.0, isolation: true },
  ],
  core: [
    { k: ["cable crunch", "crunch poulie"], c: 1.0 },
    { k: ["weighted", "plate", "leste", "con peso", "lastrado", "gewichtet", "com peso", "zavorrato"], c: 0.9 },
    { k: ["hanging", "leg raise", "knee raise", "releve de jambes", "releve de genoux", "releve", "elevacion piernas", "beinheben", "elevacao pernas"], c: 0.8 },
    { k: ["ab wheel", "ab roller", "rueda abdominal", "roulette abdo"], c: 1.1 },
    { k: ["pallof"], c: 0.6 },
    { k: ["russian twist", "torsion russe"], c: 0.5 },
    { k: ["wood chop", "woodchop", "cable chop"], c: 0.6 },
    { k: ["plank", "gainage", "prancha", "plancha"], c: 0.5 },
    { k: ["crunch", "sit up", "situp", "sit-up", "releve de buste", "abdominal", "abdominali", "abdominaux"], c: 0.9 },
  ],
};

/**
 * Broad EN+FR (+ES/DE/PT/IT) keyword hints used to guess a muscle group
 * directly from an exercise title when it isn't in the catalog. Order
 * matters: first match wins. The pseudo group "__skip__" marks
 * cardio/mobility/combat activities that must be silently ignored.
 */
export const GROUP_HINTS: readonly (readonly [GroupKey | "__skip__", readonly string[]])[] = [
  ["__skip__", [
    // Combat
    "sparring", "boxe", "boxing", "boxeo", "boxen", "boxe", "muay", "muay thai",
    "kickbox", "kickboxing", "mma", "judo", "jiu jitsu", "bjj", "grappling",
    "wrestling", "lutte", "lucha", "ringen", "luta", "lotta",
    // Endurance / conditioning
    "cardio", "course", "running", "run", "jog", "jogging", "sprint",
    "correr", "carrera", "laufen", "corrida", "corsa",
    "velo", "cycling", "bike", "biking", "spinning", "ciclismo", "radfahren",
    "row erg", "rowing machine", "ergometer",
    "swim", "swimming", "natation", "nadar", "schwimmen", "nuoto",
    "aerobic", "hiit", "tabata", "circuit training",
    // Jump rope - use multi-word only, `corda` alone is too generic
    // (`Corda Triceps` = PT for "rope triceps pushdown" would false-match).
    "corde a sauter", "jump rope", "cuerda saltar", "salto de corda",
    "seilspringen", "salto della corda",
    "stair master", "stairmaster", "elliptical", "elliptique", "cross trainer",
    "treadmill", "tapis de course", "tapis roulant", "laufband",
    "cinta de correr", "esteira",
    // Mobility / rehab
    "stretch", "stretching", "etirement", "estiramiento", "dehnung", "alongamento", "allungamento",
    "yoga", "pilates",
    "mobility", "mobilite", "movilidad", "mobilitat", "mobilidade",
    "foam roll", "rouleau",
    "walk", "walking", "marche", "hike", "hiking", "randonnee", "wandern", "caminata", "caminhada",
  ]],
  ["legs", [
    // Squat family
    "squat", "sentadilla", "kniebeuge", "agachamento", "front squat", "back squat",
    "hack squat", "sissy squat", "goblet",
    // Press machines
    "leg press", "presse a cuisses", "presse cuisse", "prensa", "beinpresse",
    "leg press", "pressa gambe", "pressa",
    "belt squat",
    // Extension / curl
    "leg extension", "extension jambe", "extension des jambes", "extension ja",
    "quad extension", "extension cuadriceps", "beinstrecker", "estensione gambe",
    "leg curl", "curl ischio", "curl jambe", "hamstring curl", "hamstring",
    "curl femoral", "beinbeuger", "flessione gambe",
    // Lunges / step-ups
    "lunge", "lunges", "fente", "zancada", "ausfallschritt", "afundo", "affondo",
    "split squat", "bulgarian",
    "step up", "step-up",
    // Calves
    "calf", "calves", "mollet", "extension mollet", "pantorrilla", "wade",
    "panturrilha", "polpaccio",
    // Hinge
    "deadlift", "souleve de terre", "peso muerto", "kreuzheben",
    "levantamento terra", "levantamento peso morto", "stacco",
    "romanian", "rdl", "stiff leg", "good morning",
    // Glutes / hip
    "hip thrust", "poussee de hanche", "empuje de cadera", "huftheben",
    "elevacao de quadril", "spinta anca",
    "glute bridge", "pont fessier", "puente gluteo", "brucke", "ponte gluteo",
    "kickback", "abduction", "adduction", "adductor", "abductor",
    "adducteur", "abducteur", "aductor", "abductor",
    "fessier", "glute", "gluteo", "gesass", "gluteo",
    "cable pull through", "pull through", "pull-through",
  ]],
  ["chest", [
    // Press
    "bench press", "developpe couche", "developpe incline", "developpe decline",
    "press banca", "prensa banca", "bankdruck", "bank drucken",
    "supino", "panca piana",
    "panca inclinata", "panca declinata", "chest press",
    "incline press", "decline press", "flat bench",
    // Fly / adduction
    "pec deck", "peck deck", "butterfly", "pec fly", "peck fly",
    "ecarte", "ecartes", "aperture", "apertura", "kurzhantel fly",
    "fly", "cable fly", "chest fly", "dumbbell fly", "cable crossover",
    // Bodyweight
    "push up", "pushup", "push-up", "pompes", "pompe",
    "flexion pecho", "liegestutz", "flessione", "flexao",
    "dip", "chest dip",
    // Generic
    "pectoraux", "pec ", "pecs", "chest ", "pecho", "brust", "peito", "petto",
  ]],
  ["back", [
    // Row family
    "row", "rowing", "bent over", "seated row", "tirage horizontal",
    "rowing barre", "rowing haltere", "rowing t-bar", "t bar row", "t-bar row",
    "chest supported row", "meadows row", "pendlay",
    "tirage", "rudern", "remo", "remada", "rematore", "vogatore",
    // Pull-up family
    "pull up", "pull-up", "pullup", "chin up", "chin-up", "chinup",
    "traction", "dominada", "dominadas", "klimmzug", "barra fixa", "trazione", "trazioni",
    "muscle up", "muscle-up",
    // Pulldown
    "pulldown", "lat pulldown", "tirage vertical", "tirage nuque", "tirage poulie",
    "jalon", "jalones", "latzug", "puxada", "lat machine",
    "lat ", "grand dorsal",
    // Hinge (also legs, but often user-classified as back)
    "deadlift", "souleve de terre", "peso muerto", "kreuzheben",
    "levantamento terra", "stacco",
    // Traps / rear delt
    "shrug", "haussement", "encogimiento", "nackenheben", "encolhimento", "scrollata",
    "reverse fly", "face pull", "rear delt", "oiseau", "rear deltoid",
    "elevation posterieure", "posterior fly",
    // Erector / lower back
    "back extension", "extension du dos", "hyperextension", "hiper extension",
    "iperestensione", "reverse hyper",
    "good morning",
    // Generic
    "dos ", "espalda", "rucken", "costas", "schiena",
  ]],
  ["shoulders", [
    // Press
    "overhead press", "shoulder press", "developpe militaire", "developpe epaule",
    "press militar", "press hombro", "schulterdrucken", "schulterpresse",
    "desenvolvimento", "pressa spalle", "military press", "arnold",
    "ohp", "push press", "strict press", "seated shoulder press",
    "landmine press",
    // Raises
    "lateral raise", "elevation lateral", "elevation laterale",
    "elevacion lateral", "seitheben", "elevacao lateral", "alzata laterale",
    "front raise", "elevation frontale", "elevation frontale",
    "elevacion frontal", "frontheben", "elevacao frontal", "alzata frontale",
    // Upright row
    "upright row", "tirage menton", "remo al menton", "aufrechtes rudern",
    "remada alta", "tirata al mento",
    // Generic
    "epaule", "epaules", "hombro", "schulter", "ombro", "spalla",
    "deltoid", "delto", "deltoide", "deltoides",
  ]],
  ["arms", [
    // Biceps
    "bicep", "biceps", "bizeps",
    "curl", "hammer curl", "curl marteau", "curl martillo",
    "hammer curl", "hammercurl", "kurzhantel curl", "rosca", "rosca alterna",
    "curl con manubri", "riccio",
    "preacher", "curl pupitre", "predicador", "scott curl",
    "concentration curl", "curl concentre",
    "curl inverse", "reverse curl", "curl invertido", "curl invertido",
    "curl 21", "spider curl", "drag curl", "zottman",
    // Triceps
    "tricep", "triceps", "trizeps", "tricipite",
    "extension triceps", "extension tri", "triceps extension",
    "pushdown", "push-down", "push down", "poulie triceps",
    "trizepsdrucken", "corda triceps",
    "kickback", "retro tricep",
    "skull crush", "skullcrusher", "barre au front", "french press",
    "close grip bench", "close-grip bench",
    "overhead extension", "extension au dessus",
    // Forearms
    "forearm", "avant-bras", "avambraccio", "unterarm", "antebraco", "antebrazo",
    "wrist curl", "curl poignet", "reverse wrist",
    "farmer", "farmer walk", "farmer carry",
  ]],
  ["core", [
    // Crunch / sit-up
    "crunch", "sit up", "sit-up", "situp", "abdominal crunch",
    "abdominale", "abdominali", "sit-up", "abdomen",
    // Plank / iso
    "plank", "gainage", "planche", "prancha", "plancha",
    "hollow hold", "l sit", "l-sit",
    // Wheel / rollout
    "ab wheel", "roulette abdo", "ab roller", "rueda abdominal",
    // Leg raise
    "leg raise", "releve de jambes", "releve de genoux", "knee raise",
    "elevacion piernas", "beinheben", "elevacao pernas",
    "hanging leg", "hanging knee", "toes to bar", "toe to bar",
    // Rotation / oblique
    "russian twist", "wood chop", "woodchop", "cable chop", "pallof",
    "torsion russe", "torsion",
    "oblique", "obliques", "oblicuo", "obliquo",
    // Generic
    "abdo", "abs ", "core", "ab ", "abdominaux",
    "bauch", "addome", "core training",
  ]],
];

/** Hevy exercise types considered "strength" (as opposed to cardio/mobility). */
export const STRENGTH_TYPES: ReadonlySet<string> = new Set([
  "weight_reps",
  "bodyweight_weighted",
  "bodyweight_assisted",
  "bodyweight_reps",
  "reps_only",
  "short_distance_weight",
  "assisted_bodyweight",
  "weighted_bodyweight",
]);

/**
 * Canonical-form stopwords (true fillers only - equipment/position words stay
 * so `Squat (Barbell)` vs `Squat (Band)` remain discriminative).
 */
export const CANON_STOPWORDS: ReadonlySet<string> = new Set([
  "the", "a", "an", "of", "and", "with", "in", "on", "for",
  "de", "du", "la", "le", "les", "des", "au", "aux", "et", "avec",
  "der", "die", "das", "den", "dem", "und", "mit",
  "el", "los", "las", "y", "con",
  "o", "os", "as", "e", "com",
  "il", "lo", "gli", "i", "con",
]);
