# Family Planner

A simple Monday–Sunday planner with each family member's schedule, pickup and drop-off assignments, and dinner plans.

## Open without installing anything

Download `family-planner.html` and double-click it to open in your browser. Use **Edit family** to change the names, then click any field to fill in your plans. Use the arrows to change weeks or **Print week** to print.

Plans save automatically in the same browser when local storage is available. They do not sync across devices. Keep using the same file and browser to access your saved plans. Google Fonts requires an Internet connection; fallback fonts work offline.

## Development

Requires Node.js 20.19+ or 22.12+.

```sh
npm ci
npm run dev
```

Create a production build with `npm run build`. Build output is in `dist/`.

The standalone `family-planner.html` contains inline copies of `style.css` and `src.js` (without the CSS import). Regenerate it after changing those source files.

No backend, accounts, or API keys are required.
