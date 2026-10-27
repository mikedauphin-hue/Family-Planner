const isIPhone = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
const installed = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const supported = () => window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
async function call(client, action, body = {}) {
  const { data, error } = await client.functions.invoke('planner-notifications', { body: { action, ...body } });
  if (error || data?.error) {
    let response;
    try { response = await error?.context?.clone().json(); } catch {}
    throw new Error(data?.error || response?.error || 'Notification setup is not available yet. Complete NOTIFICATIONS.md in the repository, then try again.');
  }
  return data;
}
function publicKeyBytes(value) {
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
}
export async function disableDeviceNotifications(client) {
  if (!supported()) return;
  const registration = await navigator.serviceWorker.getRegistration(new URL('./', document.baseURI).href);
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  const endpoint = subscription.endpoint;
  if (!await subscription.unsubscribe()) throw new Error('Could not turn off notifications on this device. Try again before signing out.');
  // Unsubscribing at the push provider stops delivery even if this cleanup request fails.
  try { await call(client, 'unsubscribe', { endpoint }); } catch {}
}
export function mountNotificationControls({ client }) {
  const button = document.querySelector('#notifications');
  const dialog = document.querySelector('#notifications-dialog');
  const message = document.querySelector('#notification-message');
  const enable = document.querySelector('#notification-enable');
  const disable = document.querySelector('#notification-disable');
  const test = document.querySelector('#notification-test');
  let registration, publicKey;
  const show = text => { message.textContent = text; };
  document.querySelector('#notification-close').onclick = () => dialog.close();
  button.onclick = async () => {
    dialog.showModal();
    enable.disabled = true; disable.disabled = true; test.disabled = true;
    if (isIPhone() && !installed()) {
      show('On each iPhone: open this website in Safari → Share → Add to Home Screen. Open the new Planner icon, sign in, then come back here to enable notifications. Requires iOS 16.4 or later.');
      return;
    }
    if (!supported()) {
      show('This browser cannot receive planner notifications. Open the hosted website over HTTPS in a supported browser. On iPhone, use the Home Screen app on iOS 16.4 or later.');
      return;
    }
    if (Notification.permission === 'denied') {
      show('Notifications are blocked. Allow notifications for this Home Screen app in iPhone Settings → Notifications, then reopen the planner.');
      return;
    }
    show('Checking notification setup…');
    try {
      const data = await call(client, 'settings');
      publicKey = data.publicKey;
      registration = await navigator.serviceWorker.register(new URL('./sw.js', document.baseURI), { scope: new URL('./', document.baseURI).pathname });
      await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      const current = subscription ? await call(client, 'status', { endpoint: subscription.endpoint }) : { enabled: false };
      enable.disabled = false;
      disable.disabled = !subscription;
      test.disabled = !current.enabled;
      show(current.enabled ? 'Enabled for this device: tomorrow’s plans at 9 p.m. Eastern. Use Send test to check delivery.' : 'Ready. Tap Enable notifications and allow the request. Each person must do this on their own device.');
    } catch (error) { show(error.message); }
  };
  enable.onclick = async () => {
    enable.disabled = true;
    try {
      // Request directly from the tap so iOS retains its required user gesture.
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('Permission was not granted. No notifications have been enabled.');
      let subscription = await registration.pushManager.getSubscription();
      const desired = publicKeyBytes(publicKey);
      const existing = subscription?.options.applicationServerKey;
      if (subscription && (!existing || String(new Uint8Array(existing)) !== String(desired))) {
        await subscription.unsubscribe(); subscription = null;
      }
      subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: desired });
      await call(client, 'subscribe', { subscription: subscription.toJSON() });
      disable.disabled = false; test.disabled = false;
      show('Enabled for this device. Tomorrow’s plans will be sent at 9 p.m. Eastern. Tap Send test to verify delivery.');
    } catch (error) { show(error.message); }
    finally { enable.disabled = false; }
  };
  disable.onclick = async () => {
    disable.disabled = true; test.disabled = true;
    try { await disableDeviceNotifications(client); show('Notifications are off for this device. Your other devices are unchanged.'); }
    catch (error) { disable.disabled = false; show(error.message); }
  };
  test.onclick = async () => {
    test.disabled = true;
    try {
      const subscription = await registration.pushManager.getSubscription();
      if (!subscription) throw new Error('Enable notifications on this device first.');
      await call(client, 'test', { endpoint: subscription.endpoint });
      show('Test sent to the push service. It contains tomorrow’s plans. Check your notifications; Focus settings can silence them.');
    } catch (error) { show(error.message); }
    finally { test.disabled = false; }
  };
}
