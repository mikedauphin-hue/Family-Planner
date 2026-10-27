# Family Planner

A Monday–Sunday planner for two people, with schedules, pickup/drop-off assignments, and dinners. Uses Supabase sign-in and field-level database writes to share plans across devices.

**Start here: [Browser-only setup guide](SETUP.md).** You need your existing GitHub account, one Supabase Free project, and two planner logins created in that project. No terminal is needed to set up or use the hosted app. Free GitHub Pages requires a public repository; planner data stays behind database access rules.

## Status

The shared app and GitHub Pages workflow are implemented. A Supabase project, two approved users, the database setup, and Pages activation are required before live synchronization works. Automated tests cover field-level sync, two simulated browser contexts, and real PostgreSQL row-level security through PGlite. They do not establish that a real Supabase project has been configured.

## Development

Requires Node.js 24.15+ (Node 24 LTS).

```sh
npm ci
npm test
npm run build
npm run dev
```

Production output is in `dist/`. `npm run build` also generates the downloadable shared `family-planner.html`. `family-planner-local.html` is the original, local-only version.

Run `supabase/setup.sql` in a dedicated Supabase project after manually creating and confirming exactly two authentication users; replace its two example emails. It enables row-level security, grants entry access only to approved members, and prevents client-side membership changes. No server secrets or build-time configuration are needed. Each browser is configured with the public project URL and publishable key, then signs in as one of the two users.

The app polls every four seconds, saves individual fields rather than whole weeks, and persists pending changes separately for each project/user. Simultaneous changes to the same field use last-save-wins semantics. This is not a collaborative text editor. Shared plans start empty; local-only plans are retained separately and not automatically uploaded.

`.github/workflows/pages.yml` builds and publishes `main` after GitHub Pages is set to GitHub Actions. Credentials and private planner data must never be committed.
