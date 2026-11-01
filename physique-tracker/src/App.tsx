import { useLiveQuery } from 'dexie-react-hooks';
import { ToastProvider } from './components/ui';
import { needsSetup } from './db';
import { useHashRoute } from './hooks';
import { useSyncState } from './sync/cloud';
import { LockGate } from './lock';
import { ReminderNotifier } from './reminders';
import { Body } from './screens/Body';
import { Coach } from './screens/Coach';
import { ExerciseLibrary } from './screens/ExerciseLibrary';
import { Food } from './screens/Food';
import { Insights } from './screens/Insights';
import { Logger } from './screens/Logger';
import { MediaScreen } from './screens/Media';
import { PlanScreen } from './screens/PlanEditor';
import { Reports } from './screens/Reports';
import { More } from './screens/More';
import { SettingsScreen } from './screens/Settings';
import { Setup } from './screens/Setup';
import { Today } from './screens/Today';
import { Week } from './screens/Week';

const NAV = [
  { id: 'today', label: 'Today', ico: '◉' },
  { id: 'week', label: 'Week', ico: '▦' },
  { id: 'body', label: 'Body', ico: '⚖' },
  { id: 'food', label: 'Food', ico: '🍽' },
  { id: 'more', label: 'More', ico: '☰' },
];

const MORE_ROUTES = ['reports', 'plan', 'exercises', 'media', 'insights', 'coach', 'settings', 'more'];

export function App() {
  const [route, go] = useHashRoute();
  const { recovery } = useSyncState();
  const setup = useLiveQuery(() => needsSetup());
  // A password-reset link lands with auth tokens in the hash; show Settings to set the new password.
  const [head, arg] = recovery ? ['settings'] : route.split('/');
  const active = head === 'session' ? 'today' : MORE_ROUTES.includes(head) ? 'more' : head;

  let screen;
  switch (head) {
    case 'session':
      screen = <Logger id={arg} go={go} />;
      break;
    case 'week':
      screen = <Week go={go} />;
      break;
    case 'body':
      screen = <Body tab={arg} go={go} />;
      break;
    case 'food':
      screen = <Food />;
      break;
    case 'plan':
      screen = <PlanScreen weekday={arg ? Number(arg) : undefined} go={go} />;
      break;
    case 'exercises':
      screen = <ExerciseLibrary go={go} />;
      break;
    case 'reports':
      screen = <Reports />;
      break;
    case 'media':
      screen = <MediaScreen />;
      break;
    case 'insights':
      screen = <Insights />;
      break;
    case 'coach':
      screen = <Coach go={go} />;
      break;
    case 'settings':
      screen = <SettingsScreen />;
      break;
    case 'more':
      screen = <More go={go} />;
      break;
    default:
      screen = <Today go={go} weekday={arg ? Number(arg) : undefined} />;
  }

  if (setup === undefined) return null;
  if (setup && !recovery) {
    return (
      <ToastProvider>
        <main className="app">
          <Setup />
        </main>
      </ToastProvider>
    );
  }

  return (
    <LockGate>
    <ToastProvider>
      <ReminderNotifier />
      <main className="app">{screen}</main>
      <nav className="nav no-print" aria-label="Main">
        {NAV.map((n) => (
          <button key={n.id} className={active === n.id ? 'on' : ''} onClick={() => go(n.id)} aria-current={active === n.id ? 'page' : undefined}>
            <span className="ico" aria-hidden>
              {n.ico}
            </span>
            {n.label}
          </button>
        ))}
      </nav>
    </ToastProvider>
    </LockGate>
  );
}
