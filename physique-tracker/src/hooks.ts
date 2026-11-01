import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { db, getSettings, getSince } from './db';
import { MUSCLE_GROUP } from './data/seed';
import { addDays, todayKey } from './lib/dates';
import { trendWeights } from './lib/formulas';
import type { History } from './lib/planner';
import type { CarryOver, DateKey, Exercise, MuscleGroup, SetLog } from './lib/types';

export const useSettings = () => useLiveQuery(getSettings);
export const useSince = () => useLiveQuery(getSince);

export function useExerciseMap() {
  return useLiveQuery(async () => new Map((await db.exercises.toArray()).map((e) => [e.id, e])));
}

export const usePlan = () => useLiveQuery(() => db.plan.orderBy('weekday').toArray());
export const usePhases = () => useLiveQuery(() => db.phases.orderBy('order').toArray());

export function useTrend() {
  const settings = useSettings();
  return useLiveQuery(async () => {
    const w = await db.weighins.toArray();
    return trendWeights(w, settings?.trendAlpha ?? 0.1, todayKey());
  }, [settings?.trendAlpha]);
}

/** Latest trend weight, falling back to the last scale weight. */
export function useCurrentWeight(): number | undefined {
  const trend = useTrend();
  return trend?.length ? trend[trend.length - 1].trend : undefined;
}

/** Re-render at midnight so "today" rolls over while the app stays open. */
export function useToday(): DateKey {
  const [t, setT] = useState(todayKey());
  useEffect(() => {
    const id = setInterval(() => setT(todayKey()), 60_000);
    return () => clearInterval(id);
  }, []);
  return t;
}

export function buildHistory(sets: SetLog[], exMap: Map<string, Exercise>, carry: CarryOver[], since: DateKey): History {
  const trainedDates = new Set<DateKey>();
  const groupsByDate = new Map<DateKey, Set<MuscleGroup>>();
  for (const s of sets) {
    if (s.isWarmup) continue;
    trainedDates.add(s.date);
    const ex = exMap.get(s.exerciseId);
    if (!ex) continue;
    const g = groupsByDate.get(s.date) ?? new Set<MuscleGroup>();
    g.add(MUSCLE_GROUP[ex.primary]);
    groupsByDate.set(s.date, g);
  }
  return { trainedDates, groupsByDate, resolved: new Set(carry.map((c) => `${c.sourceDate}|${c.exerciseId}`)), since };
}

/** Everything the carry-over planner needs, for the 21 days up to today. */
export function useHistory(today: DateKey) {
  const exMap = useExerciseMap();
  const since = useSince();
  return useLiveQuery(async () => {
    if (!exMap || !since) return undefined;
    const from = addDays(today, -21);
    const [sets, carry] = await Promise.all([
      db.sets.where('date').between(from, today, true, true).toArray(),
      db.carryovers.where('sourceDate').between(from, today, true, true).toArray(),
    ]);
    return buildHistory(sets, exMap, carry, since);
  }, [exMap, since, today]);
}

export function setsByGroup(sets: SetLog[], exMap: Map<string, Exercise>): Map<MuscleGroup, number> {
  const m = new Map<MuscleGroup, number>();
  for (const s of sets) {
    if (s.isWarmup) continue;
    const ex = exMap.get(s.exerciseId);
    if (!ex) continue;
    const g = MUSCLE_GROUP[ex.primary];
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

export function useHashRoute(): [string, (r: string) => void] {
  const get = () => window.location.hash.replace(/^#\/?/, '') || 'today';
  const [route, setRoute] = useState(get);
  useEffect(() => {
    const on = () => {
      setRoute(get());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return [route, (r: string) => (window.location.hash = '/' + r)];
}
