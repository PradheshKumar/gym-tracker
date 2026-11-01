export type DateKey = string; // 'YYYY-MM-DD' in local time (IST assumed)

export type Muscle =
  | 'chest'
  | 'upperChest'
  | 'back'
  | 'lats'
  | 'traps'
  | 'frontDelts'
  | 'sideDelts'
  | 'rearDelts'
  | 'biceps'
  | 'triceps'
  | 'forearms'
  | 'quads'
  | 'hamstrings'
  | 'glutes'
  | 'calves'
  | 'abs';

/** Muscle groups used for coverage, volume and recovery checks. */
export type MuscleGroup =
  | 'chest'
  | 'back'
  | 'shoulders'
  | 'biceps'
  | 'triceps'
  | 'quads'
  | 'hamstrings'
  | 'calves'
  | 'forearms'
  | 'abs';

export type Tier = 'C' | 'O';

export interface Exercise {
  id: string;
  name: string;
  equipment: string;
  primary: Muscle;
  secondary?: Muscle[];
  compound: boolean;
  /** Smallest sensible load jump in kg. */
  increment: number;
  cues?: string;
  custom?: boolean;
}

export interface PlannedExercise {
  exerciseId: string;
  /** Interchangeable variants, logged separately (e.g. Smith vs DB press). */
  altIds?: string[];
  sets: number;
  repMin: number;
  repMax: number;
  tier: Tier;
  notes?: string;
}

export interface DayPlan {
  /** ISO weekday 1 = Mon ... 7 = Sun */
  weekday: number;
  name: string;
  treadmillMin: number;
  isLegDay: boolean;
  rest?: boolean;
  exercises: PlannedExercise[];
}

export type SessionKind = 'planned' | 'carryover' | 'rescue' | 'custom';

export interface Session {
  id?: string;
  date: DateKey;
  weekday: number; // which day plan it follows
  kind: SessionKind;
  startedAt: number;
  endedAt?: number;
  status: 'active' | 'done';
  notes?: string;
  /** First session after a 7+ day break: ~75% loads, 2 sets. */
  returnMode?: boolean;
  /** Started in a deload week: about half the sets at ~65% loads. */
  deload?: boolean;
  /** Exercises chosen for the session, in order. */
  items: SessionItem[];
}

export interface SessionItem {
  exerciseId: string;
  sets: number;
  repMin: number;
  repMax: number;
  tier: Tier;
  source: 'plan' | 'carryover' | 'rescue' | 'added';
  sourceDate?: DateKey;
  skipped?: SkipReason;
  substitutedFrom?: string;
  notes?: string;
}

export interface SetLog {
  id?: string;
  sessionId: string;
  date: DateKey;
  exerciseId: string;
  setNo: number;
  weight: number;
  reps: number;
  rir?: number;
  isWarmup: boolean;
  completedAt: number;
}

export type SkipReason = 'time' | 'tired' | 'sick' | 'travel' | 'gym closed' | 'pain' | 'other';
export const SKIP_REASONS: SkipReason[] = ['time', 'tired', 'sick', 'travel', 'gym closed', 'pain', 'other'];

export interface Skip {
  id?: string;
  date: DateKey;
  weekday?: number;
  exerciseId?: string;
  reason: SkipReason;
}

export interface CarryOver {
  id?: string;
  sourceDate: DateKey;
  targetDate: DateKey;
  exerciseId: string;
  sets: number;
  status: 'accepted' | 'skipped' | 'rescheduled';
  reason?: SkipReason;
  rescheduledTo?: DateKey;
}

export interface Treadmill {
  id?: string;
  date: DateKey;
  minutes: number;
  speedKmh: number;
  inclinePct: number;
  weightKg: number;
  machineKcal?: number;
  netKcal: number;
}

export interface Steps {
  date: DateKey;
  steps: number;
}

export interface WeighIn {
  date: DateKey;
  kg: number;
  fasted: boolean;
}

export interface Measurement {
  id?: string;
  date: DateKey;
  site: string;
  cm: number;
}

export interface BodyFat {
  id?: string;
  date: DateKey;
  method: 'navy' | 'scale' | 'dexa';
  value: number;
}

export type Pose = 'front' | 'side' | 'back' | 'pose-video' | 'other';

export interface Media {
  id?: string;
  date: DateKey;
  type: 'photo' | 'video';
  pose: Pose;
  blob?: Blob;
  mime?: string;
  createdAtOriginal?: number;
  notes?: string;
  baseline?: boolean;
}

export interface FoodLog {
  id?: string;
  date: DateKey;
  name: string;
  kcal: number;
  p: number;
  c: number;
  f: number;
  fiber?: number;
  costInr?: number;
}

export interface Food {
  id?: string;
  name: string;
  serving: string;
  kcal: number;
  p: number;
  c: number;
  f: number;
  fiber?: number;
  costInr?: number;
}

export interface MealTemplate {
  id?: string;
  name: string;
  items: { foodId: string; qty: number }[];
}

export interface Hydration {
  date: DateKey;
  ml: number;
}

export interface CheckIn {
  date: DateKey;
  sleepH: number;
  energy: number;
  soreness: number;
  mood: number;
  hunger: number;
}

export interface PhaseTargets {
  weightKg?: number;
  bodyFatPct?: number;
  waistCm?: number;
  leanKg?: number;
}

export interface Phase {
  id: string;
  order: number;
  name: string;
  start: DateKey;
  end: DateKey;
  aim: string;
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  fiber: number;
  waterL: number;
  targets: PhaseTargets;
  milestones?: { date: DateKey; weightKg: number; waistCm: number }[];
  exitChecklist?: string[];
  /** Weekly rate of change target in kg/week (negative = loss). */
  rateMin?: number;
  rateMax?: number;
}

export interface Goal {
  id?: string;
  metric: 'weight' | 'waist' | 'bodyFat' | 'lift';
  exerciseId?: string;
  start: number;
  target: number;
  label: string;
}

export interface RuleEvent {
  id?: string;
  date: DateKey;
  rule: string;
  suggestion: string;
  status: 'accepted' | 'declined';
}

export interface Settings {
  heightCm: number;
  birthYear: number;
  sex: 'male' | 'female';
  trendAlpha: number;
  carryMaxSets: number;
  carryMaxMin: number;
  carrySetsPerExercise: number;
  rescueMaxMin: number;
  treadmillWeeklyMin: number;
  treadmillWeeklyMax: number;
  treadmillWeeklyCeiling: number;
  treadmillSessionCapMin: number;
  treadmillPreset: { minutes: number; speedKmh: number; inclinePct: number };
  restCompoundSec: number;
  restIsolationSec: number;
  landmarks: Record<MuscleGroup, { mv: number; mev: number; mav: number; mrv: number }>;
  /** Daily food budget range, INR. */
  /** Estimated maintenance calories, used on diet-break days. */
  maintenanceKcal: number;
  foodBudgetMinInr: number;
  foodBudgetInr: number;
  keepAwake: boolean;
}

/** Fields every synced record carries locally. */
export interface SyncMeta {
  /** Client clock (ms) of the last local or remote change: last write wins. */
  updatedAt?: number;
  /** updatedAt value last confirmed by the server; differs from updatedAt while a change is unsent. */
  _synced?: number;
}

export type MealSlot = 'breakfast' | 'lunch' | 'snack' | 'dinner';
export const MEAL_SLOTS: { id: MealSlot; label: string }[] = [
  { id: 'breakfast', label: 'Breakfast' },
  { id: 'lunch', label: 'Lunch' },
  { id: 'snack', label: 'Snacks / pre-post workout' },
  { id: 'dinner', label: 'Dinner' },
];

/** A food planned for a specific date, ahead of time. */
export interface FoodPlanItem {
  id?: string;
  date: DateKey;
  slot: MealSlot;
  name: string;
  kcal: number;
  p: number;
  c: number;
  f: number;
  fiber?: number;
  costInr?: number;
  /** Set once eaten: the food-log entry it became. */
  loggedId?: string;
}
