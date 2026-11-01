import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import { usePhases, useSettings } from './hooks';
import { targetsFor, type DateRange, type DayTargets } from './lib/nutrition';
import type { DateKey } from './lib/types';

export const useHighCarbDays = () => useLiveQuery(async () => ((await db.kv.get('highCarbDays'))?.value as DateKey[]) ?? []);
export const useDietBreaks = () => useLiveQuery(async () => ((await db.kv.get('dietBreaks'))?.value as DateRange[]) ?? []);

/** Targets for `date`, or undefined while loading, or null outside any phase. */
export function useDayTargets(date: DateKey): DayTargets | null | undefined {
  const phases = usePhases();
  const settings = useSettings();
  const highCarb = useHighCarbDays();
  const breaks = useDietBreaks();
  if (!phases || !settings || !highCarb || !breaks) return undefined;
  return targetsFor(date, phases, { highCarbDays: highCarb, dietBreaks: breaks, maintenanceKcal: settings.maintenanceKcal });
}
