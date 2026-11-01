// Missed-day, carry-over, rescue, coverage and treadmill make-up logic (handoff section 7).
// Pure functions: everything they need comes in as arguments so they are easy to test.
import { LEG_GROUPS, MUSCLE_GROUP, PROTECTED_GROUPS, REQUIRED_GROUPS } from '../data/seed';
import { addDays, diffDays, isoWeekday, weekDays } from './dates';
import { treadmillNetKcalPerMin } from './formulas';
import type { DateKey, DayPlan, Exercise, MuscleGroup, Settings } from './types';

export type Caps = Pick<Settings, 'carryMaxSets' | 'carryMaxMin' | 'carrySetsPerExercise' | 'rescueMaxMin'>;

export interface History {
  /** Dates with a training session (at least one completed working set). */
  trainedDates: Set<DateKey>;
  /** Muscle groups trained on each date (working sets only). */
  groupsByDate: Map<DateKey, Set<MuscleGroup>>;
  /** Carry-over decisions already made, keyed `${sourceDate}|${exerciseId}`. */
  resolved: Set<string>;
  /** First day the app should judge adherence from (no "missed" before this). */
  since: DateKey;
}

export interface CarryItem {
  sourceDate: DateKey;
  exerciseId: string;
  sets: number;
  repMin: number;
  repMax: number;
  group: MuscleGroup;
  estMin: number;
  /** Why this item is not in today's block, if it was pushed out. */
  deferReason?: string;
  suggestedDate?: DateKey;
}

export interface CarryPlan {
  mode: 'none' | 'carryover' | 'rescue' | 'return';
  missedDays: DateKey[];
  lastTrained?: DateKey;
  daysSinceLast?: number;
  today: CarryItem[];
  /** Rescue part 2 (tomorrow). */
  tomorrow: CarryItem[];
  deferred: CarryItem[];
  totals: { sets: number; minutes: number };
}

export const planFor = (plan: DayPlan[], date: DateKey) => plan.find((d) => d.weekday === isoWeekday(date));

export function estMinutesPerSet(ex: Exercise | undefined): number {
  // Working set (~45 s) plus the rest default: about 3.5 min for compounds, 2 for isolation.
  return ex?.compound ? 3.5 : 2;
}

export function groupOf(ex: Exercise | undefined): MuscleGroup {
  return ex ? MUSCLE_GROUP[ex.primary] : 'chest';
}

const isLeg = (g: MuscleGroup) => LEG_GROUPS.includes(g);
const priority = (g: MuscleGroup) => {
  const i = PROTECTED_GROUPS.indexOf(g);
  return i === -1 ? 100 : i;
};

function lastTrainedBefore(today: DateKey, h: History): DateKey | undefined {
  let best: DateKey | undefined;
  for (const d of h.trainedDates) if (d < today && (!best || d > best)) best = d;
  return best;
}

/** Scheduled training days that were missed since the last session, looking back at most 6 days. */
export function findMissedDays(today: DateKey, plan: DayPlan[], h: History): DateKey[] {
  const last = lastTrainedBefore(today, h);
  let from = addDays(today, -6);
  if (last && addDays(last, 1) > from) from = addDays(last, 1);
  if (h.since > from) from = h.since;
  const out: DateKey[] = [];
  for (let d = from; d < today; d = addDays(d, 1)) {
    const p = planFor(plan, d);
    if (p && !p.rest && p.exercises.length && !h.trainedDates.has(d)) out.push(d);
  }
  return out;
}

function nextFlexDay(today: DateKey, plan: DayPlan[]): DateKey {
  for (let i = 1; i <= 7; i++) {
    const d = addDays(today, i);
    if (planFor(plan, d)?.rest) return d;
  }
  return addDays(today, 1);
}

/** Groups that cannot take more work on `date`: trained within 48 h before it. */
function recentGroups(date: DateKey, h: History): Set<MuscleGroup> {
  const out = new Set<MuscleGroup>();
  for (const d of [addDays(date, -1), addDays(date, -2)]) h.groupsByDate.get(d)?.forEach((g) => out.add(g));
  return out;
}

/** True when putting leg work on `date` would make two leg sessions on consecutive days. */
function legsStack(date: DateKey, plan: DayPlan[], h: History, extraLegDates: Set<DateKey> = new Set()): boolean {
  const legOn = (d: DateKey) =>
    extraLegDates.has(d) ||
    (d < date ? [...(h.groupsByDate.get(d) ?? [])].some(isLeg) : !!planFor(plan, d)?.isLegDay);
  return legOn(addDays(date, -1)) || legOn(addDays(date, 1)) || !!planFor(plan, date)?.isLegDay;
}

function coreItems(
  dates: DateKey[],
  plan: DayPlan[],
  exercises: Map<string, Exercise>,
  h: History,
  setsEach: number,
  todayIds: Set<string>,
): CarryItem[] {
  const seen = new Set<string>();
  const items: CarryItem[] = [];
  for (const d of dates) {
    for (const pe of planFor(plan, d)?.exercises ?? []) {
      if (pe.tier !== 'C') continue; // never carry Optional work
      if (seen.has(pe.exerciseId) || todayIds.has(pe.exerciseId)) continue;
      if (h.resolved.has(`${d}|${pe.exerciseId}`)) continue;
      seen.add(pe.exerciseId);
      const ex = exercises.get(pe.exerciseId);
      const sets = Math.min(setsEach, pe.sets);
      items.push({
        sourceDate: d,
        exerciseId: pe.exerciseId,
        sets,
        repMin: pe.repMin,
        repMax: pe.repMax,
        group: groupOf(ex),
        estMin: sets * estMinutesPerSet(ex),
      });
    }
  }
  // Stable sort: protected groups first, then original plan order.
  return items.map((it, i) => ({ it, i })).sort((a, b) => priority(a.it.group) - priority(b.it.group) || a.i - b.i).map((x) => x.it);
}

function fill(
  items: CarryItem[],
  date: DateKey,
  maxSets: number,
  maxMin: number,
  plan: DayPlan[],
  h: History,
): { taken: CarryItem[]; rest: CarryItem[] } {
  const taken: CarryItem[] = [];
  const rest: CarryItem[] = [];
  const recent = recentGroups(date, h);
  let sets = 0;
  let mins = 0;
  for (const it of items) {
    if (recent.has(it.group)) {
      rest.push({ ...it, deferReason: `${it.group} trained in the last 48 h` });
      continue;
    }
    if (isLeg(it.group) && legsStack(date, plan, h)) {
      rest.push({ ...it, deferReason: 'would stack leg sessions on consecutive days' });
      continue;
    }
    if (sets + it.sets > maxSets || mins + it.estMin > maxMin) {
      rest.push({ ...it, deferReason: 'over the fatigue cap' });
      continue;
    }
    taken.push(it);
    sets += it.sets;
    mins += it.estMin;
  }
  return { taken, rest };
}

export function computeCarryPlan(
  today: DateKey,
  plan: DayPlan[],
  exercises: Map<string, Exercise>,
  h: History,
  caps: Caps,
): CarryPlan {
  const last = lastTrainedBefore(today, h);
  const daysSinceLast = last ? diffDays(last, today) : undefined;
  const empty = { today: [], tomorrow: [], deferred: [], totals: { sets: 0, minutes: 0 } };

  if (last && daysSinceLast !== undefined && daysSinceLast > 7) {
    return { mode: 'return', missedDays: [], lastTrained: last, daysSinceLast, ...empty };
  }

  const missedDays = findMissedDays(today, plan, h);
  if (!missedDays.length) return { mode: 'none', missedDays, lastTrained: last, daysSinceLast, ...empty };

  const todayIds = new Set((planFor(plan, today)?.exercises ?? []).flatMap((e) => [e.exerciseId, ...(e.altIds ?? [])]));
  const items = coreItems(missedDays, plan, exercises, h, caps.carrySetsPerExercise, todayIds);
  const flex = nextFlexDay(today, plan);
  const sum = (xs: CarryItem[]) => ({ sets: xs.reduce((s, x) => s + x.sets, 0), minutes: xs.reduce((s, x) => s + x.estMin, 0) });

  if (missedDays.length === 1) {
    const { taken, rest } = fill(items, today, caps.carryMaxSets, caps.carryMaxMin, plan, h);
    return {
      mode: 'carryover',
      missedDays,
      lastTrained: last,
      daysSinceLast,
      today: taken,
      tomorrow: [],
      deferred: rest.map((r) => ({ ...r, suggestedDate: flex })),
      totals: sum(taken),
    };
  }

  // Rescue: one session from the Core work of all missed days, capped, split over today and tomorrow.
  const perPart = caps.rescueMaxMin / 2;
  const tomorrowDate = addDays(today, 1);
  const p1 = fill(items, today, Infinity, perPart, plan, h);
  // Tomorrow's 48 h window includes today's planned groups plus what we just put in part 1.
  const todayGroups = new Set<MuscleGroup>([
    ...(planFor(plan, today)?.exercises ?? []).map((e) => groupOf(exercises.get(e.exerciseId))),
    ...p1.taken.map((t) => t.group),
  ]);
  const h2: History = { ...h, groupsByDate: new Map(h.groupsByDate).set(today, todayGroups) };
  const p2 = fill(
    p1.rest.map(({ deferReason: _d, ...r }) => r),
    tomorrowDate,
    Infinity,
    perPart,
    plan,
    h2,
  );
  return {
    mode: 'rescue',
    missedDays,
    lastTrained: last,
    daysSinceLast,
    today: p1.taken,
    tomorrow: p2.taken,
    deferred: p2.rest.map((r) => ({ ...r, suggestedDate: flex })),
    totals: sum([...p1.taken, ...p2.taken]),
  };
}

export interface CoverageRow {
  group: MuscleGroup;
  sets: number;
  hit: boolean;
  suggestion?: string;
}

/** Weekly coverage: which required groups have had at least one session this week, and where to place the rest. */
export function weeklyCoverage(
  today: DateKey,
  plan: DayPlan[],
  exercises: Map<string, Exercise>,
  setsByGroup: Map<MuscleGroup, number>,
  trainedDates: Set<DateKey>,
): CoverageRow[] {
  const remaining = weekDays(today).filter((d) => d >= today && !trainedDates.has(d));
  return REQUIRED_GROUPS.map((group) => {
    const sets = setsByGroup.get(group) ?? 0;
    if (sets > 0) return { group, sets, hit: true };
    const day = remaining.find((d) =>
      (planFor(plan, d)?.exercises ?? []).some((pe) => groupOf(exercises.get(pe.exerciseId)) === group),
    );
    const flex = remaining.find((d) => planFor(plan, d)?.rest);
    const suggestion = day
      ? `Planned on ${day === today ? 'today' : weekdayName(day)}`
      : flex
        ? `Add 2 core sets on ${weekdayName(flex)} (flex day)`
        : 'Not scheduled again this week: add 2 core sets to your next session';
    return { group, sets, hit: false, suggestion };
  });
}

const weekdayName = (d: DateKey) => ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][isoWeekday(d)];

export interface TreadmillMakeup {
  doneKcal: number;
  target: number;
  remainingKcal: number;
  sessionsLeft: DateKey[];
  minutesPerSession: number;
  capped: boolean;
  perMin: number;
}

/**
 * Live weekly treadmill tracking. Missed minutes move to the remaining non-leg sessions,
 * never more than the per-session cap.
 */
export function treadmillMakeup(
  today: DateKey,
  plan: DayPlan[],
  doneKcal: number,
  loggedDates: Set<DateKey>,
  weightKg: number,
  s: Pick<Settings, 'treadmillWeeklyMin' | 'treadmillSessionCapMin' | 'treadmillPreset'>,
): TreadmillMakeup {
  const perMin = treadmillNetKcalPerMin(s.treadmillPreset.speedKmh, s.treadmillPreset.inclinePct, weightKg);
  const remainingKcal = Math.max(0, s.treadmillWeeklyMin - doneKcal);
  const sessionsLeft = weekDays(today).filter((d) => {
    const p = planFor(plan, d);
    return d >= today && !!p && p.treadmillMin > 0 && !p.isLegDay && !loggedDates.has(d);
  });
  let minutesPerSession = 0;
  let capped = false;
  if (remainingKcal > 0 && sessionsLeft.length) {
    const need = Math.ceil(remainingKcal / perMin / sessionsLeft.length / 5) * 5;
    minutesPerSession = Math.min(need, s.treadmillSessionCapMin);
    capped = need > s.treadmillSessionCapMin;
  }
  return { doneKcal, target: s.treadmillWeeklyMin, remainingKcal, sessionsLeft, minutesPerSession, capped, perMin };
}

/** Planned weekly working sets per group from the plan (primary muscle only). */
export function plannedSetsByGroup(plan: DayPlan[], exercises: Map<string, Exercise>): Map<MuscleGroup, number> {
  const m = new Map<MuscleGroup, number>();
  for (const d of plan)
    for (const pe of d.exercises) {
      const g = groupOf(exercises.get(pe.exerciseId));
      m.set(g, (m.get(g) ?? 0) + pe.sets);
    }
  return m;
}
