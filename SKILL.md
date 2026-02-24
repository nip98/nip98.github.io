# NIP-98 — HTTP Auth for Nostr

## Purpose

Add passwordless HTTP authentication to any web app using signed Nostr events.
No accounts, no sessions, no cookies — just cryptographic proof of identity.

## Prerequisites

The page must have NIP-07 signing available via `window.nostr`:

```html
<!-- Any NIP-07 provider works: nos2x, Alby, nostr-login, etc. -->
<script src="https://nip-07.github.io/nip7/login.js"></script>
```

Verify keys are available:

```js
const pubkey = await window.nostr.getPublicKey()
```

## Protocol Summary

1. Client creates a `kind 27235` event with the target URL and HTTP method
2. Client signs the event with `window.nostr.signEvent()`
3. Client base64-encodes the signed event JSON
4. Client sends it as `Authorization: Nostr <base64>`
5. Server decodes, verifies signature, checks URL + method + timestamp

## Event Structure

```json
{
  "kind": 27235,
  "created_at": 1234567890,
  "tags": [
    ["u", "https://example.com/api/resource"],
    ["method", "GET"]
  ],
  "content": ""
}
```

Optional `payload` tag for requests with a body (POST/PUT/PATCH):

```json
{
  "kind": 27235,
  "created_at": 1234567890,
  "tags": [
    ["u", "https://example.com/api/resource"],
    ["method", "POST"],
    ["payload", "sha256hexhashofbody"]
  ],
  "content": ""
}
```

## Client Implementation (Zero Dependencies)

### Core: Create a NIP-98 Authorization Header

```js
async function nip98Auth(url, method, body) {
  const tags = [
    ['u', url],
    ['method', method.toUpperCase()]
  ]

  if (body) {
    const encoded = new TextEncoder().encode(body)
    const hash = await crypto.subtle.digest('SHA-256', encoded)
    const hex = [...new Uint8Array(hash)]
      .map(b => b.toString(16).padStart(2, '0')).join('')
    tags.push(['payload', hex])
  }

  const event = {
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: ''
  }

  const signed = await window.nostr.signEvent(event)
  return 'Nostr ' + btoa(JSON.stringify(signed))
}
```

### Usage: Authenticated Fetch

```js
async function authFetch(url, options = {}) {
  const method = options.method || 'GET'
  const body = options.body || null
  const auth = await nip98Auth(url, method, body)

  return fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: auth
    }
  })
}
```

### Example Calls

```js
// GET
const profile = await authFetch('https://api.example.com/me')

// POST with JSON body
const body = JSON.stringify({ name: 'alice' })
const res = await authFetch('https://api.example.com/update', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body
})

// PUT a file
await authFetch('https://files.example.com/avatar.png', {
  method: 'PUT',
  body: fileBlob
})

// DELETE
await authFetch('https://api.example.com/posts/123', { method: 'DELETE' })
```

## Drop-In Shim (Intercept All Fetch)

Inspired by [nosdav-shim](https://github.com/nosdav/nosdav-shim). Add this
script and all fetch calls automatically get NIP-98 headers:

```js
const _fetch = window.fetch

window.fetch = async function (url, options = {}) {
  const method = (options.method || 'GET').toUpperCase()
  const tags = [['u', url.toString()], ['method', method]]

  if (options.body && typeof options.body === 'string') {
    const hash = await crypto.subtle.digest(
      'SHA-256', new TextEncoder().encode(options.body)
    )
    tags.push(['payload', [...new Uint8Array(hash)]
      .map(b => b.toString(16).padStart(2, '0')).join('')])
  }

  const signed = await window.nostr.signEvent({
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: ''
  })

  options.headers = {
    ...options.headers,
    Authorization: 'Nostr ' + btoa(JSON.stringify(signed))
  }

  return _fetch.call(this, url, options)
}
```

## Server Validation

### Validation Rules (All Required)

| Check | Rule |
|-------|------|
| Kind | Must be `27235` |
| Timestamp | `created_at` must be within **60 seconds** of server time |
| URL | `u` tag must **exactly match** the request URL (including query params) |
| Method | `method` tag must match the HTTP method used |
| Signature | Event signature must be valid for the event's pubkey |
| Payload | If `payload` tag present, must match SHA-256 of request body |

On failure, return **401 Unauthorized**.

### Node.js / Express Example (Minimal)

```js
import { schnorr } from '@noble/curves/secp256k1'
import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex } from '@noble/hashes/utils'

function getTag(event, name) {
  return event.tags.find(t => t[0] === name)?.[1]
}

function serializeEvent(event) {
  return JSON.stringify([
    0, event.pubkey, event.created_at, event.kind, event.tags, event.content
  ])
}

function verifyEvent(event) {
  const hash = bytesToHex(sha256(serializeEvent(event)))
  if (hash !== event.id) return false
  return schnorr.verify(event.sig, hash, event.pubkey)
}

function nip98Auth(req, res, next) {
  const header = req.headers.authorization
  if (!header?.startsWith('Nostr ')) return res.sendStatus(401)

  let event
  try {
    event = JSON.parse(atob(header.slice(6)))
  } catch { return res.sendStatus(401) }

  const now = Math.floor(Date.now() / 1000)

  if (event.kind !== 27235) return res.sendStatus(401)
  if (Math.abs(event.created_at - now) > 60) return res.sendStatus(401)

  const fullUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`
  if (getTag(event, 'u') !== fullUrl) return res.sendStatus(401)
  if (getTag(event, 'method') !== req.method) return res.sendStatus(401)
  if (!verifyEvent(event)) return res.sendStatus(401)

  req.pubkey = event.pubkey
  next()
}
```

Use: `app.use('/api', nip98Auth)`

The only dependency is `@noble/curves` (a single-purpose cryptography library).

## Integrating Into an Existing Web App

### Step 1: Ensure NIP-07 Keys

If the app already has `window.nostr` (e.g., user has nos2x or Alby), skip this.
Otherwise add a lightweight provider:

```html
<script src="https://nip-07.github.io/nip7/login.js"></script>
```

### Step 2: Add the Auth Helper

Copy the `nip98Auth()` function above into your app's JS.

### Step 3: Replace fetch Calls to Protected Endpoints

```js
// Before
const res = await fetch('/api/data')

// After
const auth = await nip98Auth('/api/data', 'GET')
const res = await fetch('/api/data', {
  headers: { Authorization: auth }
})
```

Or use the shim for automatic auth on all requests.

### Step 4: Server-Side

Add the middleware to protected routes. The authenticated user's pubkey
is available as `req.pubkey` after validation.

## Key Design Points

- **No sessions** — each request is independently authenticated
- **No challenge-response** — the signed event is self-contained proof
- **Replay protection** — 60-second timestamp window
- **URL-bound** — token cannot be reused across endpoints
- **Method-bound** — a GET token cannot authorize a POST
- **Payload integrity** — optional SHA-256 body hash prevents tampering

## References

- [NIP-98 Specification](https://github.com/nostr-protocol/nips/blob/master/98.md) — canonical spec
- [NIP-07 Specification](https://github.com/nostr-protocol/nips/blob/master/07.md) — browser key management
- [nosdav-shim](https://github.com/nosdav/nosdav-shim) — minimal fetch shim pattern
- [nip7 test harness](https://nip-07.github.io/nip7/) — NIP-07 key setup
- [@noble/curves](https://github.com/paulmillr/noble-curves) — lightweight server-side signature verification
- [W3C HTTP Schnorr Auth](https://nostrcg.github.io/http-schnorr-auth/) — W3C formalization of this pattern
