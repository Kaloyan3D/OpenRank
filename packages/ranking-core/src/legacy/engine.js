/**
 * Shared ranking engine (browser + Node), zero dependency, no Node-only APIs.
 *
 * v0.2: a group's rank is a COMPOSITE of the user's compound lifts (non
 * isolation) practiced on at least MIN_SESSIONS distinct sessions. For each
 * exercise we estimate a 1RM (Epley, reps capped at 12), normalize it with
 * an exercise-specific coefficient (relative to the group's reference lift),
 * divide by bodyweight, then aggregate the top 3 compounds with decreasing
 * weights [1.0, 0.5, 0.25].
 *
 * Isolation lifts (calf press, back extension, pec deck, curls, etc.)
 * CANNOT define a group's rank on their own: they are only used as a
 * fallback when no qualifying compound is found (in which case the rank
 * is capped at "Titan" to avoid false Mythics).
 */

/** Minimum number of distinct sessions for an exercise to count in the rank. */
export const MIN_SESSIONS = 3;

/** Decreasing weights used for the composite aggregation (top 3 compounds). */
const COMPOSITE_WEIGHTS = [1.0, 0.5, 0.25];

/** Max tier reachable via isolation lifts only (index in RANK_TIERS). */
const ISOLATION_TIER_CAP = 5; // Titan
/** Max tier when no exercise reaches MIN_SESSIONS (very partial data). */
const FEW_SESSIONS_TIER_CAP = 3; // Platinum

/** The 9 ranks, from lowest to highest, with their emblem and color. */
export const RANK_TIERS = [
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
export const GROUPS = {
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
const PRIMARY_TO_GROUP = (() => {
  const m = {};
  for (const g of Object.values(GROUPS)) {
    for (const p of g.primaries) m[p] = g.key;
  }
  return m;
})();

/**
 * Per-exercise coefficients, per group (coeff = exercise 1RM / reference 1RM).
 * Most specific patterns first. An exercise with no match uses `def`.
 * Keywords in BOTH English and French, written WITHOUT accents (titles are
 * "deburred" before comparison), so it works regardless of the Hevy locale.
 */
// Keyword lists here are matched with a plain `includes()` (substring).
// Keep them WITHOUT accents (comparison is against a deburred title).
// Multilingual: EN + FR + ES + DE + PT + IT keywords are grouped together
// per entry so a `Prensa` (ES) or `Beinpresse` (DE) picks up the same
// leg-press coefficient as `Leg Press` (EN) or `Presse a Cuisses` (FR).
// Order matters — more specific entries must come before generic ones
// (e.g. `front squat` before `squat`; `close grip` before `bench press`).
const GROUP_COEFFS = {
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
    // Angle variants (must come first — a title like `Incline Bench Press`
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
    // "corda" is safe here — the group is already known to be arms, so
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

/** Strip accents/diacritics for robust comparison. */
function deburr(s) {
  return String(s)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Broad EN+FR keyword hints used to guess a muscle group directly from an
 * exercise title when it isn't in the catalog (typical for CSV imports in
 * non-English locales — Hevy's template catalog is English-only, but the
 * CSV export uses the user's locale). Written WITHOUT accents (titles are
 * deburred before comparison). Order matters: first match wins.
 */
const GROUP_HINTS = [
  // Cardio / mobility / combat sports — silently ignored (returns null).
  // EN + FR + ES + DE + PT + IT keywords.
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
    // Jump rope — use multi-word only, `corda` alone is too generic
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

/**
 * Guess a group key from a free-form exercise title. Returns the group key,
 * "__skip__" for cardio/mobility (caller should silently ignore), or null
 * when no hint matches. Used as a fallback for CSV-mode exercises whose
 * template isn't in the English-only catalog.
 *
 * Hints are matched on WORD boundaries (not raw substring) so that short
 * keywords like "velo" or "run" don't accidentally match inside longer
 * words like "developpe" or "running-style-something". Multi-word hints
 * ("leg press", "presse a cuisses") match as a phrase between boundaries.
 */
export function inferGroupFromTitle(rawTitle) {
  const norm = deburr(rawTitle || "");
  if (!norm) return null;
  for (const [group, hints] of GROUP_HINTS) {
    for (const h of hints) {
      if (matchesWord(norm, h)) return group;
    }
  }
  return null;
}

function matchesWord(haystack, needle) {
  const words = needle.trim().split(/\s+/).map(escapeRegex);
  if (!words.length) return false;
  // Inflection tails covered (compact alternation):
  //   -s / -es     EN / FR / ES / PT plural
  //   -e / -aux    FR gender & number
  //   -en / -er    DE plural & infinitive markers
  //   -o / -a / -i IT / ES / PT gender & plural
  // For the LAST word of a multi-word needle we additionally allow any
  // trailing letters so single-token needles like `bank` also match the
  // German compound `bankdrucken`, `bizeps` in `bizepscurl`, etc.
  // The leading boundary is always strict (start-of-string OR a non-
  // alphanumeric char) so short needles like `run` or `velo` never
  // match inside longer words such as `running` / `developpe`.
  const suffix = "(?:es|s|e|aux|en|er|o|a|i)?";
  // Compound tail ([a-z]*) is only enabled for single-word needles, and
  // only when that word is long enough (≥5 chars) so short prefixes like
  // `up` / `in` don't over-match (`Pull Upright Row` must NOT match `pull up`).
  const compound =
    words.length === 1 && words[0].length >= 5 ? "[a-z]*" : suffix;
  const inner = words
    .map((w, i) => `${w}${i === words.length - 1 ? compound : suffix}`)
    .join("\\s+");
  const re = new RegExp(`(?:^|[^a-z0-9])${inner}(?:$|[^a-z0-9])`);
  return re.test(haystack);
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Convert workouts from the Hevy API into the engine's "sessions" format. */
export function workoutsToSessions(workouts) {
  return (workouts ?? []).map((w) => ({
    date: (w.start_time ?? w.created_at ?? "").slice(0, 10),
    title: w.title ?? "",
    exercises: (w.exercises ?? []).map((ex) => ({
      title: ex.title ?? "",
      templateId: ex.exercise_template_id ?? null,
      sets: (ex.sets ?? []).map((s) => ({
        weight: s.weight_kg,
        reps: s.reps,
        type: s.type ?? "normal",
      })),
    })),
  }));
}

/** 1RM estimation (Epley formula), reps capped at 12 to stay realistic. */
export function estimate1RM(load, reps) {
  const w = Number(load);
  const r = Math.min(Number(reps), 12);
  if (!Number.isFinite(w) || !Number.isFinite(r) || w <= 0 || r <= 0) return 0;
  if (r === 1) return w;
  return w * (1 + r / 30);
}

/** Reverse Epley: for a given target 1RM, weight that should be liftable
 *  for `reps` reps. Used to translate 1RM targets into actionable
 *  "hit X kg × 5 reps" recommendations. */
export function weightForReps(oneRm, reps) {
  const one = Number(oneRm);
  const r = Number(reps);
  if (!Number.isFinite(one) || !Number.isFinite(r) || one <= 0 || r <= 0)
    return 0;
  if (r === 1) return one;
  return one / (1 + r / 30);
}

/**
 * Detect assisted/weighted bodyweight variants directly from the exercise
 * title. Needed because when the CSV title doesn't match the (English-only)
 * template catalog — typically for non-English Hevy exports or user-renamed
 * exercises — `tpl?.type` is missing and we fall back to `weight_reps`. That
 * fallback silently inverts the load semantics: for `Pull Up (Assisted)`
 * with 40 kg of assistance we'd compute `bw + 40` (harder) instead of
 * `bw - 40` (easier), inflating the user's Back / Chest score with the
 * *more* assistance they use. This detector runs on the raw title and
 * wins over the template type when it fires.
 */
function detectBodyweightVariantFromTitle(title) {
  if (!title) return null;
  const t = deburr(String(title)).toLowerCase();
  // Assisted markers (EN + FR + ES + DE + PT + IT). Anchored to word-ish
  // boundaries via a leading non-alnum to avoid matching "assistant" etc.
  const assisted =
    /(?:^|[^a-z0-9])(assisted|assiste|assistee|aided|assist|band|banded|con banda|con goma|elastico|elastique|mit band|assistita|assistito|assistida|assistido)(?:$|[^a-z0-9])/;
  const weighted =
    /(?:^|[^a-z0-9])(weighted|leste|lestee|charge|chargee|con peso|com peso|gewichtet|zusatzgewicht|zavorrato|zavorrata|pesado|pesada|belt)(?:$|[^a-z0-9])/;
  if (assisted.test(t)) return "bodyweight_assisted";
  if (weighted.test(t)) return "bodyweight_weighted";
  return null;
}

/** Hevy exercise types considered "strength" (as opposed to cardio/mobility). */
const STRENGTH_TYPES = new Set([
  "weight_reps",
  "bodyweight_weighted",
  "bodyweight_assisted",
  "bodyweight_reps",
  "reps_only",
  "short_distance_weight",
  "assisted_bodyweight",
  "weighted_bodyweight",
]);

/** Effective load of a set depending on the Hevy exercise type. */
export function effectiveLoad(weightKg, type, bodyweightKg) {
  const w = Number(weightKg);
  const bw = Number(bodyweightKg) || 0;
  const hasW = Number.isFinite(w) && w > 0;
  switch (type) {
    case "weight_reps":
    case "short_distance_weight":
      return hasW ? w : null;
    case "bodyweight_weighted":
      return bw + (hasW ? w : 0);
    case "bodyweight_assisted": {
      // Effective load = bodyweight minus assistance. Skip the set when
      // assistance meets or exceeds bodyweight (nothing to normalize).
      const eff = bw - (hasW ? w : 0);
      return eff > 0 ? eff : null;
    }
    default:
      // reps_only, duration, distance_duration, etc.: no measurable load
      return null;
  }
}

export function sexFactor(sex) {
  return String(sex).toLowerCase().startsWith("f") ? 0.72 : 1;
}

/** On machines/cables you can load more, so higher coeff => fairer rank. */
function equipFactor(equipment) {
  switch (equipment) {
    case "machine":
      return 1.5;
    case "cable":
      return 1.3;
    case "smith_machine":
    case "smith":
      return 1.35;
    default:
      return 1;
  }
}

/**
 * Returns { coeff, isolation } for a given exercise in the group.
 * If no keyword matches, uses the default coefficient adjusted by equipment
 * and isolation = false (we assume the default targets a compound lift).
 */
function matchCoeff(title, groupKey, equipment) {
  const t = deburr(title);
  for (const entry of GROUP_COEFFS[groupKey] ?? []) {
    if (entry.k.some((kw) => t.includes(kw))) {
      return { coeff: entry.c, isolation: !!entry.isolation };
    }
  }
  return {
    coeff: GROUPS[groupKey].def * equipFactor(equipment),
    isolation: false,
  };
}

/**
 * Fraction of bodyweight effectively lifted on a pure bodyweight movement
 * (reps_only, no external load), so it can still be scored.
 */
function bodyweightFraction(title, groupKey) {
  const t = deburr(title);
  if (/(pull up|pull-up|pullup|chin|traction|dominada|klimmzug|barra fixa|trazion|muscle up)/.test(t)) return 0.6;
  if (/(pistol|squat|sentadilla|kniebeuge|agachamento)/.test(t)) return 0.5;
  if (/(push up|pushup|push-up|pompe|flexion|liegestutz|flessione|flexao)/.test(t)) return 0.35;
  if (/(dip)/.test(t)) return 0.45;
  if (groupKey === "core") return 0.25;
  return 0.4;
}

/** Reference 1RM/BW equivalent -> tier index (0..8). */
function ratioToTierIndex(ratio, thresholds, factor) {
  let idx = 0;
  for (let i = 0; i < thresholds.length; i++) {
    if (ratio >= thresholds[i] * factor) idx = i;
  }
  return idx;
}

/**
 * Builds an index of the exercise catalog (by id and by normalized title).
 * @param {Array} templates - data/exercise-templates.json
 */
export function buildCatalog(templates) {
  const byId = new Map();
  const byTitle = new Map();
  // Secondary index for fuzzy lookups: same words in any order, no parens,
  // no equipment/stopwords. Lets `Barbell Bench Press` match the catalog's
  // `Bench Press (Barbell)`, `Squat Barbell` match `Squat (Barbell)`, etc.
  const byCanonical = new Map();
  const norm = (s) => deburr(String(s).trim());
  for (const t of templates) {
    if (t.id) byId.set(t.id, t);
    if (t.title) {
      byTitle.set(norm(t.title), t);
      const canon = canonicalTitle(t.title);
      if (canon && !byCanonical.has(canon)) byCanonical.set(canon, t);
    }
  }
  return { byId, byTitle, byCanonical, norm, canon: canonicalTitle };
}

/**
 * Canonical form of an exercise title used as a fallback lookup key when
 * the exact normalized title isn't found. Strips accents, punctuation,
 * parentheses and common equipment / positional stopwords, then sorts
 * the remaining tokens alphabetically so word-order variations collapse
 * to the same key. Returns null when nothing meaningful is left.
 */
// Deliberately kept SHORT. Do NOT strip equipment (barbell / dumbbell /
// cable / machine) or position (incline / decline / seated) — they are
// what distinguishes templates like `Squat (Barbell)` vs `Squat (Band)`
// or `Bench Press (Barbell)` vs `Incline Bench Press (Barbell)`.
// Only true fillers go here so the canonical form remains discriminative.
const CANON_STOPWORDS = new Set([
  "the", "a", "an", "of", "and", "with", "in", "on", "for",
  "de", "du", "la", "le", "les", "des", "au", "aux", "et", "avec",
  "der", "die", "das", "den", "dem", "und", "mit",
  "el", "los", "las", "y", "con",
  "o", "os", "as", "e", "com",
  "il", "lo", "gli", "i", "con",
]);
function canonicalTitle(title) {
  const raw = deburr(String(title || ""))
    .replace(/[()[\]{}]/g, " ")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/-/g, " ")
    .trim();
  if (!raw) return null;
  const tokens = raw
    .split(/\s+/)
    .filter((w) => w && !CANON_STOPWORDS.has(w));
  if (!tokens.length) return null;
  return tokens.slice().sort().join(" ");
}

/**
 * Aggregates eqRatios into a composite score (weighted average of top N).
 * If fewer than N lifts, only the corresponding weights are used.
 */
function compositeRatio(lifts, weights = COMPOSITE_WEIGHTS) {
  const top = lifts.slice(0, weights.length);
  if (!top.length) return null;
  let num = 0;
  let den = 0;
  for (let i = 0; i < top.length; i++) {
    if (top[i].eqRatio == null) continue;
    num += top[i].eqRatio * weights[i];
    den += weights[i];
  }
  return den > 0 ? num / den : null;
}

/**
 * Compute an actionable "how to reach the next tier" recommendation for a
 * group, by figuring out how much heavier the user's top compound would
 * need to be if pushed alone (other composite contributors held constant).
 *
 * Returns null when there's no meaningful next step (already at top tier,
 * no bodyweight, no compound lift, etc.). Otherwise:
 *   {
 *     nextTier,        // RANK_TIERS entry we're aiming at
 *     topLift,         // the lift the user should push (title, current 1RM, coeff)
 *     required1RM,     // 1RM that top lift needs to reach
 *     delta1RM,        // required1RM - topLift.best1RM
 *     targetForReps,   // { reps, weight } — reverse-Epley translation
 *     currentForReps,  // { reps, weight } — same reps, current capacity
 *     tooFar,          // true when delta > 30% of current 1RM (rough "far" flag)
 *   }
 */
export function nextTierRecommendation(group, opts = {}) {
  if (!group || !group.hasData || !group.used?.length) return null;
  if (!group.next?.tier) return null; // already at Mythic
  if (group.capped) return null; // fallback tier; different advice needed

  const bw = Number(opts.bodyweightKg ?? group.bodyweightKg);
  if (!Number.isFinite(bw) || bw <= 0) return null;

  const top = group.used[0];
  if (!top || !top.coeff || !top.best1RM) return null;

  const weights = COMPOSITE_WEIGHTS.slice(0, group.used.length);
  const sumW = weights.reduce((a, b) => a + b, 0);
  // Contribution of lifts 2..N to the composite numerator (held constant).
  let heldSum = 0;
  for (let i = 1; i < group.used.length; i++) {
    heldSum += weights[i] * (group.used[i].eqRatio ?? 0);
  }
  // targetComposite * sumW = w0 * newRatio0 + heldSum
  //   => newRatio0 = (targetComposite * sumW - heldSum) / w0
  const targetComposite = group.next.ratio;
  const newRatio0 = (targetComposite * sumW - heldSum) / weights[0];
  const required1RM = newRatio0 * top.coeff * bw;
  const delta1RM = required1RM - top.best1RM;

  // Pick a rep target close to the user's actual best-set rep count so the
  // recommendation feels concrete (defaults to 5 reps if none available).
  const reps = Math.max(1, Math.min(10, Math.round(top.reps || 5)));

  return {
    nextTier: group.next.tier,
    topLift: {
      title: top.title,
      best1RM: top.best1RM,
      coeff: top.coeff,
      currentReps: top.reps,
    },
    required1RM,
    delta1RM,
    targetForReps: { reps, weight: weightForReps(required1RM, reps) },
    currentForReps: { reps, weight: weightForReps(top.best1RM, reps) },
    tooFar: delta1RM > top.best1RM * 0.3,
  };
}

/**
 * Computes the rank of each muscle group.
 *
 * @param {Array} sessions - [{ date, exercises:[{ title, templateId?, sets:[{weight,reps,type?}] }] }]
 * @param {object} catalog - result of buildCatalog()
 * @param {object} opts - { bodyweightKg, sex, minSessions }
 * @returns {object} rich result: see the `groups[key]` structure below
 *   groups[key] = {
 *     group, hasData, tierIndex, tier, next, progress,
 *     eqRatio,        // composite ratio used
 *     source,         // 'compound' | 'isolation' | 'few_sessions' | null
 *     capped,         // true when the tier was capped by a fallback
 *     lifts,          // all lifts of the group (sorted desc), with isolation/sessions
 *     used,           // lifts that contributed to the composite (top 3 compounds)
 *     excluded,       // excluded lifts + reason ('isolation' | 'few_sessions')
 *     best,           // lift with the highest eqRatio among `used` (CLI compat)
 *   }
 *   unmatched : Set of unrecognized exercise titles (custom / cardio)
 *   unmatchedDetails : Map(title -> {sessions, reason:'unknown'|'no_load'})
 */
export function computeRanks(
  sessions,
  catalog,
  { bodyweightKg, sex = "male", minSessions = MIN_SESSIONS } = {}
) {
  const bw = Number(bodyweightKg);
  const hasBw = Number.isFinite(bw) && bw > 0;
  const factor = sexFactor(sex);

  // groupKey -> Map(title -> aggregated lift). A "lift" = best set on that exercise.
  const perGroup = {};
  for (const key of Object.keys(GROUPS)) perGroup[key] = new Map();
  const unmatchedTitles = new Set();
  // title -> { sessions:Set<date>, reason:'unknown'|'no_load' }
  const unmatchedDetails = new Map();
  // Track how each strength exercise was routed (distinct titles), so the
  // UI can warn the user when many exercises came in via the FR/EN keyword
  // fallback instead of the exact English catalog — a strong signal that
  // Hevy was set to a non-English locale when the CSV was exported.
  const catalogMatched = new Set();
  const inferredMatched = new Set();

  for (const s of sessions) {
    for (const ex of s.exercises ?? []) {
      let tpl = ex.templateId ? catalog.byId.get(ex.templateId) : null;
      if (!tpl && ex.title) tpl = catalog.byTitle.get(catalog.norm(ex.title));
      // Fuzzy fallback: same words in any order (`Barbell Bench Press` ↔
      // catalog's `Bench Press (Barbell)`), or the same title with extra
      // equipment/position stopwords the user may have added.
      if (!tpl && ex.title && catalog.byCanonical && catalog.canon) {
        const canon = catalog.canon(ex.title);
        if (canon) tpl = catalog.byCanonical.get(canon);
      }
      const primary = tpl?.primary;
      let groupKey = primary ? PRIMARY_TO_GROUP[primary] : null;
      const cameFromCatalog = groupKey != null;
      const rawTitle = ex.title ?? tpl?.title ?? "";

      let type = ex.type ?? tpl?.type ?? "weight_reps";
      // Title-based override for assisted / weighted bodyweight variants.
      // Wins over the template type on purpose: these markers ("Assisted",
      // "Weighted", "Band", FR/ES/DE/PT/IT equivalents) unambiguously carry
      // the load semantics, and this is the only signal we get when the
      // catalog lookup missed (non-English CSVs, custom names).
      const variantOverride = detectBodyweightVariantFromTitle(rawTitle);
      if (variantOverride) type = variantOverride;
      // Cardio, mobility, etc.: silently ignored (not surfaced in the
      // dashboard's "not counted" section which is strength-only).
      let isStrength = STRENGTH_TYPES.has(type);

      // Fallback for CSV imports in non-English locales: the Hevy template
      // catalog is English-only, so a French title like "Squat (Barre)" or
      // "Presse a Cuisses" won't be found. Try to infer the group directly
      // from the title using FR+EN keyword hints.
      if (!groupKey && rawTitle) {
        const guess = inferGroupFromTitle(rawTitle);
        if (guess === "__skip__") {
          isStrength = false; // silently ignored (cardio / mobility / combat)
        } else if (guess) {
          groupKey = guess;
        }
      }

      if (!groupKey) {
        if (rawTitle && isStrength) {
          unmatchedTitles.add(rawTitle);
          const d = unmatchedDetails.get(rawTitle) ?? {
            title: rawTitle,
            sessions: new Set(),
            reason: "unknown",
          };
          if (s.date) d.sessions.add(s.date);
          unmatchedDetails.set(rawTitle, d);
        }
        continue;
      }
      const title = tpl?.title ?? ex.title ?? "";
      const equipment = tpl?.equipment;

      let hadUsableSet = false;
      let bestOfExercise = null;

      for (const set of ex.sets ?? []) {
        if (set.type === "warmup") continue;
        const reps = Number(set.reps);
        if (!Number.isFinite(reps) || reps <= 0) continue;

        let load = effectiveLoad(set.weight, type, bw);
        if (
          load == null &&
          bw > 0 &&
          (type === "reps_only" || type === "bodyweight_reps")
        ) {
          load = bw * bodyweightFraction(title, groupKey);
        }
        if (load == null || load <= 0) continue;

        const oneRm = estimate1RM(load, reps);
        if (oneRm <= 0) continue;

        hadUsableSet = true;
        if (!bestOfExercise || oneRm > bestOfExercise.best1RM) {
          bestOfExercise = {
            title,
            best1RM: oneRm,
            load,
            reps: Number(set.reps),
            date: s.date ?? null,
          };
        }
      }

      // No usable set: surface it ONLY if the type is a "strength" one
      // (otherwise = cardio/mobility -> silent).
      if (!hadUsableSet) {
        if (rawTitle && isStrength) {
          const d = unmatchedDetails.get(rawTitle) ?? {
            title: rawTitle,
            sessions: new Set(),
            reason: "no_load",
          };
          if (s.date) d.sessions.add(s.date);
          unmatchedDetails.set(rawTitle, d);
        }
        continue;
      }

      if (cameFromCatalog) catalogMatched.add(rawTitle);
      else if (rawTitle) inferredMatched.add(rawTitle);

      const map = perGroup[groupKey];
      const prev = map.get(title);
      if (!prev) {
        const meta = matchCoeff(title, groupKey, equipment);
        map.set(title, {
          ...bestOfExercise,
          coeff: meta.coeff,
          isolation: meta.isolation,
          sessions: new Set(bestOfExercise.date ? [bestOfExercise.date] : []),
        });
      } else {
        if (bestOfExercise.best1RM > prev.best1RM) {
          Object.assign(prev, {
            best1RM: bestOfExercise.best1RM,
            load: bestOfExercise.load,
            reps: bestOfExercise.reps,
            date: bestOfExercise.date,
          });
        }
        if (bestOfExercise.date) prev.sessions.add(bestOfExercise.date);
      }
    }
  }

  const groups = {};
  for (const [key, cfg] of Object.entries(GROUPS)) {
    // Enrich each lift with eqRatio + sessionsCount, sorted desc.
    const allLifts = [...perGroup[key].values()]
      .map((l) => ({
        title: l.title,
        best1RM: l.best1RM,
        load: l.load,
        reps: l.reps,
        date: l.date,
        coeff: l.coeff,
        isolation: l.isolation,
        sessionsCount: l.sessions.size,
        eqRatio: hasBw ? l.best1RM / l.coeff / bw : null,
      }))
      .sort((a, b) => (b.eqRatio ?? 0) - (a.eqRatio ?? 0));

    // Categorization
    const enoughSessions = (l) => l.sessionsCount >= minSessions;
    const compounds = allLifts.filter((l) => !l.isolation && enoughSessions(l));
    const isolations = allLifts.filter((l) => l.isolation && enoughSessions(l));

    let used = [];
    let source = null;
    let cap = null;

    if (compounds.length > 0) {
      used = compounds.slice(0, COMPOSITE_WEIGHTS.length);
      source = "compound";
    } else if (isolations.length > 0) {
      // No qualifying compound: fall back to isolation lifts (cap Titan).
      used = isolations.slice(0, COMPOSITE_WEIGHTS.length);
      source = "isolation";
      cap = ISOLATION_TIER_CAP;
    } else if (allLifts.length > 0) {
      // No exercise reaches MIN_SESSIONS: use whatever we have (cap Platinum),
      // so the group isn't shown as empty when there's actually data.
      used = allLifts.slice(0, COMPOSITE_WEIGHTS.length);
      source = "few_sessions";
      cap = FEW_SESSIONS_TIER_CAP;
    }

    const eqRatio = used.length ? compositeRatio(used) : null;
    const capped = cap != null;

    // Everything that wasn't used: surface it with a reason.
    const usedTitles = new Set(used.map((l) => l.title));
    const excluded = allLifts
      .filter((l) => !usedTitles.has(l.title))
      .map((l) => ({
        ...l,
        reason: !enoughSessions(l) ? "few_sessions" : "isolation",
      }));

    let tierIndex = null;
    let progress = 0;
    let next = null;
    if (eqRatio != null) {
      tierIndex = ratioToTierIndex(eqRatio, cfg.thresholds, factor);
      if (cap != null && tierIndex > cap) tierIndex = cap;
      const cur = cfg.thresholds[tierIndex] * factor;
      const nextThresh =
        tierIndex < cfg.thresholds.length - 1
          ? cfg.thresholds[tierIndex + 1] * factor
          : null;
      if (nextThresh != null) {
        const span = nextThresh - cur;
        progress = span > 0 ? (eqRatio - cur) / span : 1;
        next = {
          tier: RANK_TIERS[tierIndex + 1],
          ratio: nextThresh,
          remaining: Math.max(0, nextThresh - eqRatio),
        };
      } else {
        progress = 1;
      }
    }

    const g = {
      group: cfg,
      lifts: allLifts,
      used,
      excluded,
      best: used[0] ?? allLifts[0] ?? null,
      eqRatio,
      source,
      capped,
      hasData: used.length > 0 && eqRatio != null,
      tierIndex,
      tier: tierIndex != null ? RANK_TIERS[tierIndex] : null,
      next,
      progress: Math.min(1, Math.max(0, progress)),
    };
    g.recommendation = nextTierRecommendation(g, { bodyweightKg: bw });
    groups[key] = g;
  }

  return {
    bodyweightKg: hasBw ? bw : null,
    sex,
    minSessions,
    groups,
    unmatched: unmatchedTitles,
    unmatchedDetails,
    matchStats: {
      catalog: catalogMatched.size,
      inferred: inferredMatched.size,
      total: catalogMatched.size + inferredMatched.size,
    },
  };
}
