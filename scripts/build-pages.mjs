#!/usr/bin/env node
/**
 * Build both frontends into a single static site for GitHub Pages:
 *
 *   <base>/            -> landing page linking to the two apps
 *   <base>/customer/   -> customer app  (built with its own base path)
 *   <base>/gcs/        -> GCS app
 *
 * Because both apps are served from the same origin, they share localStorage,
 * so the in-browser demo backend links them: an order booked in /customer shows
 * up as a live drone in /gcs. No API server required.
 *
 * Env:
 *   PAGES_BASE  URL path the site is served under (default "/Full-stack-App-Thesis").
 *   VITE_API_URL  If set, the static apps talk to that hosted API instead of demo mode.
 */
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const base = (process.env.PAGES_BASE ?? '/Full-stack-App-Thesis').replace(/\/$/, '');
const outDir = resolve(root, 'site');

function run(cmd, env) {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } });
}

console.log(`Building Pages site with base "${base}"`);

run('npm run build:shared');

run('npm run build --workspace @drone/customer', {
  BASE_PATH: `${base}/customer/`,
});
run('npm run build --workspace @drone/gcs', {
  BASE_PATH: `${base}/gcs/`,
});

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
cpSync(resolve(root, 'apps/customer/dist'), resolve(outDir, 'customer'), {
  recursive: true,
});
cpSync(resolve(root, 'apps/gcs/dist'), resolve(outDir, 'gcs'), {
  recursive: true,
});

const landing = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Drone Delivery — Thesis Demo</title>
    <style>
      :root { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center;
             background: #0f172a; color: #e5e7eb; padding: 24px; }
      .card { max-width: 460px; text-align: center; }
      h1 { font-size: clamp(24px, 6vw, 34px); margin-bottom: 8px; }
      p { color: #9ca3af; line-height: 1.5; }
      .links { display: grid; gap: 12px; margin-top: 24px; }
      a { display: block; padding: 16px; border-radius: 12px; text-decoration: none;
          font-weight: 700; font-size: 18px; }
      .customer { background: #4338ca; color: #fff; }
      .gcs { background: #1d4ed8; color: #fff; }
      .note { font-size: 13px; margin-top: 20px; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>🚁 Drone Delivery</h1>
      <p>Master's thesis demo — autonomous drone package delivery with a web
         Ground Control Station. Open both on your phone.</p>
      <div class="links">
        <a class="customer" href="customer/">Customer app — book &amp; track</a>
        <a class="gcs" href="gcs/">Ground Control Station — map &amp; telemetry</a>
      </div>
      <p class="note">Running in in-browser demo mode (mock drone). Book a delivery
         in the customer app, then open the GCS to watch it fly.</p>
    </div>
  </body>
</html>
`;
writeFileSync(resolve(outDir, 'index.html'), landing);
// Prevent Jekyll from touching the Vite output (files starting with _).
writeFileSync(resolve(outDir, '.nojekyll'), '');

console.log(`\nPages site written to ${outDir}`);
