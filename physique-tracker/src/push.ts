// Background (Web Push) reminders: this device subscribes, and the Supabase send-reminders
// function pushes due reminders even when the app is closed.
import { VAPID_PUBLIC_KEY } from './push-key';
import { supabase } from './sync/cloud';

const FLAG = 'push.enabled';

export const pushSupported = () =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && !!VAPID_PUBLIC_KEY && !!supabase;

/** True when this device relies on server pushes, so in-app notifications should stay quiet. */
export const pushActiveHere = () => {
  try {
    return localStorage.getItem(FLAG) === '1';
  } catch {
    return false;
  }
};

function keyBytes(b64url: string): Uint8Array {
  const b64 = (b64url + '='.repeat((4 - (b64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export async function pushSubscribed(): Promise<boolean> {
  if (!pushSupported()) return false;
  const reg = await navigator.serviceWorker.getRegistration();
  return !!(await reg?.pushManager.getSubscription());
}

export async function enablePush() {
  if (!pushSupported()) throw new Error('This browser cannot receive push notifications.');
  const { data } = await supabase!.auth.getUser();
  if (!data.user) throw new Error('Sign in to cloud sync first; reminders are sent from your account.');
  if ((await Notification.requestPermission()) !== 'granted') throw new Error('Notifications are blocked for this site in Chrome settings.');
  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) }));
  const j = sub.toJSON();
  const { error } = await supabase!.from('push_subscriptions').upsert(
    {
      endpoint: sub.endpoint,
      user_id: data.user.id,
      p256dh: j.keys?.p256dh,
      auth: j.keys?.auth,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata',
    },
    { onConflict: 'endpoint' },
  );
  if (error) throw new Error(error.message);
  localStorage.setItem(FLAG, '1');
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await supabase?.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
    await sub.unsubscribe();
  }
  localStorage.removeItem(FLAG);
}
