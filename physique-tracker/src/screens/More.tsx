import { Card } from '../components/ui';

const ITEMS = [
  { id: 'reports', label: 'Reports & badges', sub: 'Weekly and monthly reports, Year in Review, wins, badges (save as PDF)' },
  { id: 'plan', label: 'Weekly plan', sub: 'Edit days, exercises, sets, reps, tiers; templates' },
  { id: 'exercises', label: 'Exercise library', sub: 'Custom exercises, target muscles, form cues' },
  { id: 'media', label: 'Progress photos & videos', sub: 'Ghost camera, timeline, compare' },
  { id: 'insights', label: 'Insights', sub: 'Lifts, PRs, volume per muscle, adherence' },
  { id: 'coach', label: 'Coach & phases', sub: 'Phase tracker, rules, roadmap' },
  { id: 'body/goals', label: 'Goals', sub: 'Weight, waist, body fat, lifts' },
  { id: 'settings', label: 'Settings & data', sub: 'Backup, export, rest timers, caps, about' },
];

export function More({ go }: { go: (r: string) => void }) {
  return (
    <>
      <header className="top">
        <h1>More</h1>
      </header>
      <Card>
        <ul className="list">
          {ITEMS.map((i) => (
            <li key={i.id} onClick={() => go(i.id)} role="button" style={{ cursor: 'pointer', minHeight: 56 }}>
              <div className="grow">
                <div>{i.label}</div>
                <small>{i.sub}</small>
              </div>
              <span className="muted">›</span>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
