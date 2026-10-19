# Sentry source maps and production deploy

The web build creates hidden source maps when `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, and `SENTRY_PROJECT` are set. Hidden maps omit `sourceMappingURL` comments. The Sentry Vite plugin uploads those maps and removes them from `apps/web/dist`; without upload credentials, Vite does not generate maps.

The root build runs `npm run check:sourcemaps` after the web build. This check fails if any `.map` file or JavaScript `sourceMappingURL` comment remains in `apps/web/dist`. Its unit test uses in-memory file fixtures.

## Production deploy from the box

Create an ignored `.env.sentry` file in the repository root with the Sentry values `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`, and `SENTRY_DSN`. Add `POSTHOG_KEY` if the production client should enable PostHog. Set `CLOUDFLARE_API_TOKEN` in the shell. Keep these values out of source control.

Run `npm run deploy:prod` to build the game, server, and web client, upload web and Worker source maps to Sentry, apply D1 migrations with `wrangler d1 migrations apply starhold --remote`, then run `wrangler deploy`. The Worker upload injects debug IDs before upload. The web build uploads its maps through the Vite plugin. A migration failure stops the deploy.
