// Record ids. Random UUIDs for user data; deterministic ids for seed rows so that
// every device seeds identical rows and they merge instead of duplicating.
export const uuid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });

export const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export const foodId = (name: string) => `food-${slug(name)}`;
export const mealId = (name: string) => `meal-${slug(name)}`;
export const measId = (date: string, site: string) => `meas-${date}-${slug(site)}`;
export const navyBfId = (date: string) => `bf-${date}-navy`;
export const goalId = (metric: string, exerciseId?: string) => `goal-${metric}${exerciseId ? `-${exerciseId}` : ''}`;
export const baselineMediaId = (date: string) => `media-baseline-${date}`;
