# Tomorrow's plans at 9 p.m. Eastern — two iPhones

The app code is prepared, but notifications are **not active** until the Supabase setup below is complete and both phones have opted in. No new service account is needed. Use your existing Supabase project and GitHub Pages website. No terminal is required.

The summary includes tomorrow's two schedules, drop-off, pickup, and dinner. It uses **America/New_York** and follows daylight saving time. Long fields are shortened; tapping opens the correct week in the planner.

## Owner setup — do once

### 1. Add the notification tables

1. Open [`supabase/notifications.sql`](supabase/notifications.sql) in GitHub and click **Raw**. Copy all its text.
2. In your existing Supabase **Family Planner** project, open **SQL Editor → New query**, paste, and click **Run**.
3. Expect **Success**. This adds private device registrations and delivery records. It does not change your schedules, names, or the two approved users.

### 2. Generate three notification keys in your browser

1. Once GitHub's **Publish planner** action has a green check, open:
   https://mikedauphin-hue.github.io/Family-Planner/notification-keys.html
2. Click **Generate keys** once.
3. Keep this page open. Store the three generated values in your password manager:
   - `VAPID_PUBLIC_KEY` — public browser key.
   - `VAPID_PRIVATE_KEY` — private sending key.
   - `PLANNER_CRON_SECRET` — private scheduler credential.

These are generated on your device. The generator does not upload or save them. Do not send the two private values to the coding assistant, put them in GitHub, or share them with the other planner user. Do not generate replacements later unless you intend to re-enable notifications on every device.

### 3. Add the keys to Supabase and deploy the sender

1. In Supabase, open **Edge Functions → Secrets** (sometimes under **Functions → Secrets**).
2. Add those three secrets, using each exact name above and its generated value. Also add `APP_URL` with the non-secret value `https://mikedauphin-hue.github.io/Family-Planner/`.
3. Open [`supabase/functions/planner-notifications/index.ts`](supabase/functions/planner-notifications/index.ts) in GitHub. Click **Raw** and copy the entire file.
4. In Supabase **Edge Functions**, choose **Deploy a new function → Via Editor** (or the equivalent browser editor). Name the function exactly **`planner-notifications`**.
5. Replace the editor's `index.ts` contents with the copied code, and deploy it.
6. In this function's settings, turn **Verify JWT** / **Enforce JWT verification** **OFF** and save. Redeploy if the dashboard requests it.

**Why this permission setting changes:** the nightly scheduler uses a private cron secret rather than a user login token. The supplied function verifies that secret for scheduled sends. For every device registration or test, it independently verifies the signed-in user's token with Supabase and checks that they are one of the two approved members. Do not disable database row-level security. The server's Supabase service-role key is automatically supplied inside Edge Functions; never copy that key into the app or GitHub.

### 4. Schedule the nightly task

1. Open Supabase **Database → Extensions**. Enable **pg_cron** and **pg_net**. Some dashboards expose these through **Integrations → Cron**.
2. Open [`supabase/schedule-notifications.sql`](supabase/schedule-notifications.sql) in GitHub, click **Raw**, and copy it into a new Supabase SQL Editor query.
3. Near the top, replace:
   - `REPLACE_WITH_PROJECT_URL` with the same Supabase Project URL you used in the app, without a trailing slash.
   - `REPLACE_WITH_PLANNER_CRON_SECRET` with your private cron secret from step 2.
4. Keep the surrounding single quotes. Click **Run** and expect success.
5. In Supabase's Cron view, confirm a job named **planner-nightly-eastern** exists. Its schedule is `0,5,10 1,2 * * *`.

The schedule checks both possible Eastern-to-UTC offsets. The sender only runs at **9:00, 9:05, or 9:10 p.m. Eastern**: the first attempt is 9:00, and later attempts retry missed sends. Delivery records prevent ordinary repeats. All credentials used by the job are stored in Supabase Vault, not public tables. The SQL query contains your private cron secret while you run it: do not commit it or share it outside your project.

## Each person — do on their own iPhone

1. Use **iOS 16.4 or later**. Open the planner website in **Safari**.
2. Tap **Share → Add to Home Screen**. If shown, leave **Open as Web App** enabled, then tap **Add**.
3. Open the new Planner icon from the Home Screen. If asked, enter your project connection details and sign in with your own planner account. Safari's saved login may not carry over to the Home Screen app.
4. Tap **Notifications** near the top of the planner.
5. Tap **Enable notifications**, then **Allow** on the iPhone permission prompt.
6. Tap **Send test**. A test containing tomorrow's plans should appear in Notification Center. If needed, return to the Home Screen or lock the phone to check it. Tests are limited to one per minute per device.
7. Repeat on the other iPhone. One person's permission does not enable the other phone.

Once enabled, the app does not need to remain open. No Apple Developer account or texting service is needed. Web Push runs through the browser's push service; on iPhone that's Apple's push infrastructure.

**Privacy:** the notification contains schedule details and may appear on the Lock Screen. If preferred, set iPhone **Settings → Notifications → Planner → Show Previews → When Unlocked**. Other people with access to an unlocked phone could still see it.

**Delivery limits:** free Supabase projects can pause after inactivity; a paused or unavailable backend cannot run the schedule. Free-plan quotas still apply. Push-service acceptance does not prove the phone displayed the notification. Network problems, Focus modes, notification permissions, or iOS settings can delay or silence alerts. Failed sends can retry at 9:05/9:10. There is no later catch-up after the nightly window. The push message expires after an hour. A rare server interruption after a successful send can cause a repeat attempt; notifications use the same date tag/topic to replace duplicates where supported.

## Turn notifications off

In the planner, choose **Notifications → Turn off on this device**. This unsubscribes that device only. Signing out also unsubscribes the current device before ending the session. Closing the app does not turn notifications off.

To stop the nightly job for everyone, unschedule **planner-nightly-eastern** in Supabase's Cron view. Do not delete your planner tables or users. Removing someone's planner membership stops future scheduled sends to their saved subscriptions.

## Troubleshooting

- **“Add to Home Screen” instructions:** close Safari and open the Home Screen icon instead. If the new manifest hasn't loaded yet, refresh Safari before adding it again.
- **“Setup is not available / incomplete”:** finish the owner steps above. Check the function name, secret names, notification SQL success, and Verify JWT setting. Reopen the Notifications dialog to retry.
- **Blocked permission:** allow this Home Screen app under iPhone **Settings → Notifications**. You may need to remove and re-add the Home Screen app if iOS offers no way to request again.
- **Test failed:** check Supabase **Edge Functions → planner-notifications → Logs**. Do not paste tokens, private keys, subscription endpoints, or schedule contents into a public issue. If a key pair was replaced, choose **Enable notifications** again on both phones.
- **Test works but nothing at 9:** check the Cron job is enabled, the project is not paused, and function invocations occur at 01:00 UTC in summer / 02:00 UTC in winter. Check `planner_notification_deliveries` in Supabase Table Editor: `sent_at` means the push service accepted it, not that it displayed on the phone.

Current validation covers schedule/date logic, authorization, subscription isolation, duplicate prevention, frontend controls, and the production build. Delivery through your actual Supabase project and Apple's push service must be confirmed with **Send test** on both iPhones and a real 9 p.m. run.
