# Debug Report: `crypto is not defined` in GitHub Auth Poll Endpoint

**Date:** 2026-03-19
**Severity:** P0 — Blocks all user authentication
**Endpoint:** `POST /auth/github/poll`
**Environment:** Railway production (`forj-api-production`)

---

## Symptom

The GitHub OAuth Device Flow **initiation** works (`/auth/github/device` returns a device code), but **polling** always fails with:

```json
{"success":false,"error":"Failed to poll for GitHub token: crypto is not defined"}
```

This blocks all user authentication — no one can log in or use the CLI.

## Reproduction

```bash
# Step 1: Works fine — returns deviceCode + userCode
curl -s -X POST https://api.forj.sh/auth/github/device \
  -H "Content-Type: application/json" -d '{}'

# Step 2: Always fails — crypto is not defined
curl -s -X POST https://api.forj.sh/auth/github/poll \
  -H "Content-Type: application/json" \
  -d '{"deviceCode":"<any_valid_device_code>"}'
```

## Root Cause Analysis

### The Error Path

1. `POST /auth/github/poll` handler in `packages/api/src/routes/auth-github.ts`
2. Before even calling GitHub's API, the handler validates `GITHUB_ENCRYPTION_KEY` using `isValidEncryptionKey()` from `packages/api/src/lib/encryption.ts`
3. `encryption.ts` does `import crypto from 'node:crypto'` at the module top level
4. It also runs `const pbkdf2 = promisify(crypto.pbkdf2)` at module scope
5. If `crypto` is undefined, this throws `"crypto is not defined"` when the module is first imported

### Why `crypto` Is Undefined

The API is bundled with `tsup` (esbuild) into a single `dist/index.js` ESM file. The built output shows:

```js
// Line 992 in dist/index.js
import crypto from "crypto";
```

This import is syntactically valid, but there are two possible failure modes:

#### Theory 1: esbuild Bundles Crypto as Empty Module (Most Likely)

When `crypto` is not listed in `external`, esbuild tries to bundle it. Since `crypto` is a Node.js builtin with no file on disk, esbuild may resolve it to an empty/shim module. The `import crypto from "crypto"` line in the output looks correct, but esbuild may have already resolved it during bundling and the import statement is a no-op pointing to an internal empty definition.

**Evidence:** The `tsup.config.ts` originally had `external: ['pg', 'ioredis', 'ws', '@neondatabase/serverless']` — no Node builtins. We added `/^node:/` but esbuild normalizes `node:crypto` → `crypto` before the regex match, so the regex never fires.

**Fix applied (commit 828e175):** Changed to explicitly list all Node.js builtins using `builtinModules`:
```ts
import { builtinModules } from 'node:module';
const nodeBuiltins = builtinModules.flatMap((mod) => [mod, `node:${mod}`]);
// ...
external: ['pg', 'ioredis', 'ws', '@neondatabase/serverless', ...nodeBuiltins],
```

**Status:** Pushed but not yet confirmed working in Railway. The built output still shows `import crypto from "crypto"` — need to verify if esbuild actually externalizes it now vs. just emitting the same import statement but internally shimming it.

#### Theory 2: Railway's Node.js Version or ESM Configuration

Railway is running Node 18 (from Dockerfile.api / Railpack auto-detection). The `import crypto from "crypto"` default import should work in Node 18 ESM, but:

- If the package.json doesn't have `"type": "module"`, Node may not treat `.js` files as ESM
- If Railway's build caches a previous broken bundle, the fix won't deploy

**To verify:**
```bash
# SSH into Railway container or check via deploy logs
node -e "import('crypto').then(m => console.log(typeof m.default?.randomBytes))"
```

#### Theory 3: Default Export Issue

`crypto` in Node.js is a CJS module. When imported as ESM default import (`import crypto from "crypto"`), Node wraps it. But if esbuild bundles it, the CJS-to-ESM interop may produce `crypto.default` instead of `crypto` directly, leaving `crypto.randomBytes` as undefined and `crypto.pbkdf2` as undefined — which would cause `promisify(crypto.pbkdf2)` to throw.

**To verify:** Check the bundled output more carefully for how `crypto` is used after the import.

## Other Issues Found During Investigation

### 1. Namecheap IP Whitelisting (Separate Issue)

Railway's **outbound** IP is `162.220.234.81` (visible in server logs), but `NAMECHEAP_CLIENT_IP` was set to `172.56.35.221` (the inbound proxy IP). All Namecheap API calls fail with:

```
"Invalid request IP: 162.220.234.81"
```

**Fix:** Update `NAMECHEAP_CLIENT_IP` to `162.220.234.81` in Railway env vars AND whitelist it in Namecheap dashboard.

### 2. Workers Crash Loop (Separate Issue)

Workers are repeatedly getting SIGTERM:
```
npm error signal SIGTERM
npm error command sh -c node dist/start-workers.js
```

This may be Railway killing the process due to:
- Missing Redis connection
- Memory limits exceeded
- Health check failures
- The same crypto issue if workers also use encryption

### 3. Sentry ECONNRESET (Separate Issue)

```
Error: read ECONNRESET
  File "node:internal/stream_base_commons", line 217, in TCP.onStreamRead
```

TCP connection reset — likely Redis or Postgres connection dropping during Railway restarts. Needs connection retry logic.

## Files Involved

| File | Role |
|------|------|
| `packages/api/tsup.config.ts` | Bundle config — **root cause** |
| `packages/api/src/lib/encryption.ts` | Uses `crypto` — where error throws |
| `packages/api/src/routes/auth-github.ts` | Calls encryption, catches error |
| `packages/api/src/lib/github-oauth.ts` | GitHub Device Flow client |
| `packages/api/src/lib/api-key-service.ts` | Also uses `crypto` — likely broken too |
| `packages/api/src/lib/user-rate-limiter.ts` | Uses `randomUUID` from `crypto` |
| `packages/api/src/routes/projects.ts` | Uses `randomUUID` from `crypto` |

## Verification Steps After Fix

```bash
# 1. Verify build output actually externalizes crypto
grep "from.*crypto" packages/api/dist/index.js
# Should show: import crypto from "node:crypto" or "crypto"
# AND it should NOT have any crypto implementation bundled inline

# 2. Test locally
node packages/api/dist/index.js
# Should start without crypto errors

# 3. Test poll endpoint after Railway deploy
curl -s -X POST https://api.forj.sh/auth/github/poll \
  -H "Content-Type: application/json" \
  -d '{"deviceCode":"fake123"}'
# Should return: {"success":false,"error":"Failed to poll for GitHub token: ...bad_verification_code..."}
# NOT: "crypto is not defined"

# 4. Test full auth flow
curl -s -X POST https://api.forj.sh/auth/github/device \
  -H "Content-Type: application/json" -d '{}'
# Use the returned deviceCode to poll:
curl -s -X POST https://api.forj.sh/auth/github/poll \
  -H "Content-Type: application/json" \
  -d '{"deviceCode":"<real_code>"}'
# Should return: {"success":true,"data":{"status":"pending",...}}
```

## Potential Nuclear Fix

If the externalization approach continues to fail, **stop bundling entirely** and use `tsc` directly:

```json
// packages/api/package.json
{
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js"
  }
}
```

This eliminates the bundler entirely. The API doesn't need bundling — it runs on a server with `node_modules` available. Bundling is only useful for the CLI (single-file distribution).

## Commits Related to This Issue

| Commit | Description |
|--------|-------------|
| `01c466f` | CLI auth flow fix (login first, Device Flow implementation) |
| `52b7793` | Improved error logging in poll endpoint (surfaced actual error) |
| `96b6e62` | First attempt: externalize `node:` prefixed imports (didn't work) |
| `828e175` | Second attempt: externalize all builtins via `builtinModules` (pending verification) |
