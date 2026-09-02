# Local notifications spec (Phase 7)

OpenRank notifications are **entirely local**: scheduled reminders derived
from the user's own training plan and rest timers, delivered by the OS
scheduler through expo-notifications. There is **no push backend, no
server, no cloud messaging, no cron**: nothing leaves the device, and a
device that is off simply delivers late or not at all - the plan never
depends on delivery.

## 1. Why one-off jobs instead of recurring OS patterns

The obligation ledger is the single source of truth
(docs/STREAK_SPEC.md). Sessions are generated from the weekly plan but
their fates diverge immediately (completed / missed / paused / cancelled /
rescheduled / disabled). A weekly recurring OS trigger cannot respect any
of that - it would remind on rest days, after completions and during
pauses. OpenRank therefore schedules **one-off OS notifications**, each
backed by a durable notification_jobs row, and re-derives the entire
desired set on every reconcile. Recurring OS triggers are never used.

## 2. Architecture

- SQLite (notification_jobs, notification_preferences, ledger)
- NotificationService - the deterministic reconciler
- NotificationPlatform - adapter interface
- OS scheduler (expo-notifications; NullNotificationPlatform elsewhere)

- NullNotificationPlatform is the default (tests, non-mobile shells):
  permission "undetermined", scheduling is a no-op.
- ExpoNotificationPlatform (apps/mobile) is the only code touching
  expo-notifications: two Android channels ("Training Reminders", "Rest
  Timers"), date triggers, graceful no-op cancels.
- The service never touches expo APIs; the platform never reads SQLite.

## 3. Permission UX (opt-in, pre-permission)

- Everything defaults OFF. No prompt on first launch, no nagging.
- Pre-permission explainer: the schedule screen asks "Would you like
  reminders on those days?" AFTER training days are configured; the
  notifications screen explains scope before the OS dialog. The OS
  permission dialog is requested only after the user presses
  "Enable reminders".
- Outcomes: granted -> reminders on for enabled days; denied -> status
  stored, UI switches to "Open system settings", training functionality
  unchanged (zero behavioral coupling); undetermined (emulator/no
  hardware) -> remains askable.
- Reconciling without granted permission cancels everything the service
  had scheduled (defense in depth).

## 4. Desired set and reconcile algorithm

reconcileNotifications(profileId, { todayUtc, timezoneOffsetMinutes })
is the ONLY scheduling entry point. It is deterministic, idempotent and
safe to call from anywhere (startup, schedule edit, reschedule, workout
finish, rest-timer change, settings screen). Exactly one now() read per
run. Steps:

1. Read prefs; if permission != granted -> cancelEverything (all job rows
   cancelled, OS ids cancelled) and stop.
2. Build the desired set:
   - Training primary: for every PENDING session within the 7-day horizon
     (NOTIFICATION_HORIZON_DAYS = 7), on a day whose schedule day is
     enabled AND has a reminder time, at reminderInstant(date, minutes,
     offset).
   - Training secondary (opt-in): same session, primary time +
     secondary_delay_minutes, only if strictly before the logical day
     end (local 04:00 next day) and in the future. Max 2 per session.
   - Rest timer (opt-in): one notification at the active rest's endsAt
     when it is in the future.
3. Merge against scheduled job rows by dedupe_key
   ("<sessionId>:training_primary|training_secondary",
   "rest:<workoutId>"), comparing a FNV-1a payload_hash of the exact OS
   copy:
   - unchanged intent + OS id still present -> no-op;
   - row without OS id -> reschedule (drift repair, spec AC);
   - changed intent -> cancel + reschedule (updateScheduled);
   - new -> INSERT OR IGNORE (partial UNIQUE makes this idempotent) +
     schedule;
   - scheduled rows not in desired -> cancelled (+ OS cancel);
   - OS ids not claimed by ANY profile's scheduled rows -> cancelled
     (orphans);
   - rows past due and not in the OS -> expired.
4. Prune terminal rows older than 30 days.

Report (NotificationReconcileReport): scheduled / cancelled / expired /
repaired / permission. Reconcile failures are ALWAYS non-blocking: the
caller pattern is fire-and-forget with .catch(() => {}) - workout
logging, history, ranks and streaks never depend on it.

## 5. Reminder-time semantics

- Times are stored per training day as minutes after local midnight
  (UI choices: 08:00 / 11:00 / 17:00 / 18:30 / 19:00).
- The logical training day ends at local 04:00 (DAY_BOUNDARY_MINUTES =
  240, shared implementation with the ledger). A reminder minute below
  240 belongs to the NEXT calendar day's wall time (a Tuesday 01:00
  reminder serves Monday's session).
- logicalDayEndInstant caps secondaries; nothing is scheduled past the
  training day, past now, or outside the horizon.
- Rescheduled sessions inherit the reminder time from the ORIGINAL
  weekday (fallback chain: scheduledDate's weekday -> originalDate's
  weekday) so moving a session keeps the user's chosen time.

## 6. Lifecycle coupling (the ledger always wins)

- Completion (workout finish flow): after streak processing, the app
  reconciles - the completed session's remaining reminders disappear.
  Tap-to-complete never happens: notifications are reminders, and only
  explicit user action creates workouts (spec AF).
- Pause: future sessions flip to paused -> reminders cancelled; removing
  a future pause reopens them -> reminders reappear.
- Reschedule: old session's reminders cancelled; the target gets fresh
  ones at the inherited time.
- Disable: all pending sessions cancel (including past-due, see
  STREAK_SPEC hardening) -> zero reminders while off.
- Re-enable / schedule edit: regeneration + reconcile rebuild the
  plan-derived set.
- Timezone change: reconcile takes the device offset each run; jobs are
  re-derived in absolute time. History is NEVER rewritten - only future
  notifications move.
- Rest timer: RestTimerService notifies an observer on every change; the
  service layer defers the reconcile to a macrotask so the ledger write
  commits first, then re-derives the single rest notification (+15 /
  -15 / skip / clear each end in exactly one OS notification).
- Process death: job rows survive; the next reconcile repairs OS drift
  without duplicates (spec AC).

## 7. Copy and personalities (spec M)

Reminder style is a preference: gentle / normal / competitive
(competitive copy stays effort-framed, never body-shaming, no numeric
streak counts in OS copy). Primary/secondary bodies are exact, versioned
strings hashed into payload_hash; changing copy reschedules cleanly.

## 8. Deep links (specs AE/AF/AG/AW)

Taps route through validateNotificationPayload (strict shape check) +
resolveNotificationRoute: training reminders -> Home (the
planned-workout CTA lives there; the user decides), rest timers -> the
active workout screen ONLY if that workout still exists and is active,
anything malformed -> Home. A tap NEVER creates a workout, never
auto-starts one, and never bypasses the active-workout conflict rule.

## 9. Failure recovery

Every failure mode degrades to "no notifications": reconcile errors are
swallowed and retried at the next natural point; OS drift is repaired on
the next reconcile; a denied permission simply means silence. The
training plan itself is fully usable with notifications entirely off.
