# ADR 0002: A client without a build step

- Status: accepted (Phase 2), replacing the plan's recommendation of Vite
- Date: 2026-10-07

## Context

The plan recommended Vite, with JavaScript type-checked through JSDoc, to
bundle the client. The main reasons were to stop loading libraries from
CDNs and to split `client.js` into modules.

By Phase 2 the client had no runtime dependencies left. Socket.IO serves
its own ES module build from the app's origin
(`/socket.io/socket.io.esm.min.js`), and the icons are a static SVG
sprite. Every browser we support loads native ES modules.

## Options

1. **Vite**: bundling, minification and a dev server with hot reload. It
   adds a build to every deploy, and a second place (the bundler config)
   where paths and the CSP have to agree.
2. **Native ES modules, served as they are**: what the browser runs is
   what's in `public/js`. Nothing to build, and the Render deploy stays
   `npm ci && node app.js`.

## Decision

Option 2. The client is about 20 small modules, and each is cached and
revalidated with an ETag. Without bundling the strict CSP stays simple
(`script-src 'self'`). Unit tests import the same modules directly in
Node.

## Consequences

- No minification. The whole client is well under the plan's 100 KB
  gzipped budget anyway, and compression is on.
- Module imports are fetched in waterfalls on a cold load. If that ever
  shows up in measurements, `<link rel="modulepreload">` for the entry
  points is the first step, and a bundler can still be added later
  without changing the modules.
- Type checking is through ESLint and tests, not `tsc`.
