# Add a private read-only login

Keep Mike and Marilyn as editors and give another person their own viewing login. No public sharing is enabled, and no new service account is needed. Your existing plans, editing accounts, and notifications are preserved.

The app update alone does not approve anyone. Complete both Supabase steps below.

## 1. Create the viewer's login

1. Open your Supabase **Family Planner** project.
2. Open **Authentication → Users → Add user → Create new user**.
3. Enter the viewer's email and a unique temporary password of at least 12 characters. Use an email different from either existing editor.
4. Enable **Auto confirm user**, if shown, and create the user. Confirm they appear in the list as confirmed.

Keep your global public sign-up setting off. Creating a user manually in the project dashboard does not require opening sign-up to everyone. Do not share either editor's credentials with the viewer.

## 2. Give that user read-only access

1. In GitHub, open [`supabase/add-viewer.sql`](supabase/add-viewer.sql), click **Raw**, and copy all the text.
2. In Supabase, open **SQL Editor → New query** and paste it.
3. Find this line near the bottom:

   ```sql
   viewer_email text := 'REPLACE-VIEWER@example.com';
   ```

4. Replace only the example email with the new viewer's exact email. Keep the single quotes and semicolon.
5. Run the **whole script**. Expect **Success**.

This is additive and can be run again safely. It registers the selected account in `planner_viewers`, which grants SELECT access only. Existing INSERT/UPDATE rules still require editor membership in `planner_members`. The script refuses to use an existing editor's email, so it cannot accidentally downgrade Mike or Marilyn. It does not remove previously approved viewers or change notification registrations.

Do **not** add the viewer to `planner_members`—that table grants editing rights. Do not rerun the original `setup.sql` for this task.

## 3. Open and test the viewer account

After the GitHub **Publish planner** workflow finishes:

1. On a separate device or in a private browser window, open https://mikedauphin-hue.github.io/Family-Planner/ . Testing separately avoids signing out either editor's Home Screen app and turning off that device's notifications.
2. Connect using the **same Supabase Project URL and public publishable/anon key** as your current planner.
3. Sign in with the **viewer's own email and password**.
4. Check for the **Read-only access** notice. They can browse weeks, select/copy text, print, change their own password, and sign out. Plan fields cannot be edited; Edit names, Customize planner, and Notifications controls are hidden.
5. As an editor on your usual device, change a field. Confirm the viewer sees it within a few seconds.

The viewer sees both people's schedules, rides, dinners, and shared wording for all saved weeks. This is not a limited-date or redacted view. Only the original editor accounts receive/manage nightly notifications in this version; the notification function needs no redeployment.

## Remove viewer access later

In Supabase **Table Editor → planner_viewers**, delete that viewer's row. Keep your own editor memberships intact. Further database reads will be denied. A viewer may have already read, copied, printed, or cached prior information; removing access cannot undo those copies.

If a viewer remains signed in, the next successful refresh will clear the plan fields after access is removed. On their next sign-in, they will see the access-not-approved screen.

## If you see an error

- **Create and confirm the viewer account first:** check the email in the script and confirm that Authentication user.
- **This email belongs to an existing editor:** use a new third account. The script did not change your editor accounts.
- **Account not approved / missing planner_viewers table:** run the complete add-viewer script with the correct email, then use **Check access again** or sign in again.
- **The viewer can edit:** check that they did not sign in with an editor's email and that their user ID was not manually added to `planner_members`.

Do not send passwords, secret keys, or access tokens in chat. The viewer only needs the website link, public project connection details, and their own login credentials.
