# Set up a private planner for two people — no terminal

The code is prepared for shared storage. It will not sync until you complete this setup and try it on two devices.

## Exactly what accounts you need

| Account | Who needs it | Purpose |
| --- | --- | --- |
| GitHub Free (your existing account) | Planner owner only | Stores the app and hosts its website with GitHub Pages |
| Supabase Free | Planner owner only | One project stores the plans and manages sign-in |
| Two planner logins (email + password) | One per person | Created inside your Supabase project, not separate Supabase dashboard accounts |

No Netlify, Vercel, paid email provider, domain purchase, or credit card is needed for this design. Select the Free plan, not a paid trial or upgrade. Provider plans can change. Free Supabase projects may pause after inactivity; resume a paused project from its dashboard. This is not a promise of permanent free hosting or uninterrupted availability.

**GitHub Pages on GitHub Free requires a public repository.** Public app code is visible to everyone; your actual plans remain private in Supabase behind sign-in and database access rules. Do not put plans, passwords, database passwords, or Supabase secret keys into GitHub. If you do not want to make this repository public, stop before changing its visibility; a different host will be needed.

## 1. Create one free Supabase project

1. Open https://supabase.com and create an account (email or GitHub sign-in).
2. If you use GitHub sign-in, read the authorization screen. That permission signs you into Supabase; the planner itself does not need access to your GitHub repositories.
3. Create a **Free** organization/project named `Family Planner`. Choose a nearby region.
4. Generate a strong database password and store it in your password manager. The planner never needs that password.
5. Wait for the project to finish starting.

## 2. Create the two planner logins

This approach does not send invitation emails or rely on Supabase's limited built-in email delivery.

1. In the Supabase project, open **Authentication → Users**.
2. Choose **Add user → Create new user** (not “Send invitation”).
3. Enter the first person's email and a unique temporary password of at least 12 characters. Enable **Auto confirm user** if shown, so this account is confirmed without an email.
4. Repeat for the second person with a different email and a different temporary password.
5. Check that both users appear and are confirmed.
6. Under **Authentication → Sign In / Providers** (sometimes labeled **Providers**), keep **Email/password** enabled and turn off **Allow new users to sign up**. Keep existing-user sign-in enabled. Dashboard labels may vary.

Give each person only their own temporary password through a private channel, not a GitHub issue or this chat. Once signed in, they can choose **Change password** in the app. Email ownership is not checked by this manual process: you are personally choosing and confirming the two accounts.

## 3. Install the private database rules

1. In this repository, open `supabase/setup.sql`.
2. Click **Raw**, then select and copy all the text.
3. In Supabase, open **SQL Editor → New query** and paste it.
4. Near the bottom, replace `REPLACE-FIRST@example.com` and `REPLACE-SECOND@example.com` with the exact two emails you just created. Keep the surrounding single quote marks.
5. Click **Run**. Expect a success message. If it says both accounts must be confirmed, check step 2 and the email spelling, then rerun the whole query.

This creates the planner tables and row-level security rules. Only the two selected user IDs can read or change plans; they cannot approve new members through the app. Anyone else, even someone who knows your website address and public project key, is denied planner access.

**Permissions:** SQL Editor runs with project-owner privileges. The supplied script creates two tables and policies, and replaces the approved member list with exactly these two people. Rerunning it changes who can access the existing planner; it does not delete planner entries. Use a new, dedicated project for this planner.

## 4. Turn on the website

1. Open your GitHub repository: https://github.com/mikedauphin-hue/Family-Planner
2. Ensure the repository is public if you are using GitHub Free. Changing visibility is under **Settings → General → Danger Zone → Change repository visibility**. Read GitHub's warning before doing this. Skip this if already public.
3. Open **Settings → Pages**.
4. Under **Build and deployment → Source**, select **GitHub Actions**.
5. Open **Actions → Publish planner → Run workflow → Run workflow**, using `main`. If GitHub asks to enable Actions in this repository, enable it.
6. Wait for a green check. Return to **Settings → Pages** and click **Visit site**. Bookmark that address. For the current repository, the usual address is `https://mikedauphin-hue.github.io/Family-Planner/`, but use the URL GitHub actually displays.

The included workflow asks for **Pages write** and **ID token write** permission so GitHub can publish the site. It only needs read access to repository contents. It does not require a personal access token. Publishing a website is a separate action from saving code to GitHub.

If deployment says Pages is not enabled, finish step 4 and rerun the workflow. If a plan upgrade is requested, check whether the repository is private; do not buy an upgrade just for this setup.

## 5. Connect each device — once per browser

1. In Supabase, copy the **Project URL** from the project's **Connect** dialog or **Settings → Data API**.
2. Open **Settings → API Keys** and copy the **Publishable key**, beginning with `sb_publishable_`. Create a publishable key there if one has not been generated yet.
3. Open your planner website, paste the Project URL and Publishable key into the two fields, and click **Connect planner**.
4. Sign in with that person's planner email and password.
5. Choose **Change password** at the bottom to replace their temporary password.
6. Repeat on the other device using the **same URL and publishable key**, but the other person's login.

The publishable key is designed for browser apps; it is not an administrator credential. Do not use a key starting `sb_secret_`, a `service_role` key, your database password, or a GitHub token. The app rejects secret keys in its connection form. No credentials need to be sent to the coding assistant.

## 6. Check it really shares

1. On device A, change Monday dinner to `Tacos` and wait for **Synced**.
2. On device B, open the same week. After a few seconds, confirm it says `Tacos`.
3. On B, change Tuesday pickup; check that A sees it too.
4. Refresh both devices and confirm both edits remain.
5. Use **Edit names** to label your two schedule columns. This changes labels, not the approved sign-in accounts.
6. Choose **Customize planner** near the top to change the app name, main heading, and tagline. Click **Save changes** to share your wording with both people across all weeks. **Use default wording** fills the original text back in; click **Save changes** to apply it.

Both people can edit either person's schedule, rides, and dinners. Changes are checked every four seconds while the page is open. Background browser tabs may update more slowly. Changes to different fields are saved separately. If both people change the same field, the last successfully saved change wins.

Once loaded, unsent edits are kept on that device and retried after a connection problem. Do not clear browser data while changes are unsynced. Opening the app initially still requires a working sign-in and access check. Signing out removes the on-screen planner, but a device-local cache remains for retrying unsent changes: use trusted devices, or clear this site's browser data after confirming everything has synced.

The shared planner starts empty. Old plans remain in the original browser's local storage under the old planner key; they are not automatically uploaded. Downloaded older copies of the app do not automatically update. `family-planner-local.html` preserves the original local-only app; `family-planner.html` is the new shared version.

## If you get stuck

- **Account not approved / One more step:** confirm the two users exist, then run the complete SQL script with those exact emails. Click **Check access again**.
- **Invalid login credentials:** check the email/password. Use the temporary password until you change it.
- **Not synced:** check Internet access and whether the Supabase project is paused. Edits remain queued on the same device; leave the app open to retry. Never solve this by disabling row-level security.
- **Forgotten password:** because this setup does not configure email delivery, ask the project owner to set a new temporary password for the user through the Supabase dashboard's user management. Then change it in the app. If that control is unavailable, use Supabase's documented account recovery/admin options; do not delete/recreate a user without updating membership.

Tell the assistant which step you are on and the exact error message. Do not paste passwords or secret keys into chat.
