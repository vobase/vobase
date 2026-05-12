---
'@vobase/template': patch
---

fix(template/whatsapp): derive sandbox-claim environment from STAGING env, not NODE_ENV

The Dockerfile pins `ENV NODE_ENV=production` for every tenant container,
so a staging Railway deployment running `NODE_ENV=production` was claiming
a `production`-tier sandbox channel — the link message rendered
`mgd-<orgId>-production` even on the staging URL. The platform's
`set-staging-env-vars` step already stamps `STAGING=true` only on staging
Railway environments (production leaves it unset), so the tenant now reads
that flag to pick `production | staging` for `/managed/claim`. The
resulting `(tenant, environment, channelInstanceId)` key — and the
platform-pool slot it allocates — now corresponds to the deploy
environment the user is sitting in.
