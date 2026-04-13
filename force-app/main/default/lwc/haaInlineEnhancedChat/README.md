# Technical Reference - haaInlineEnhancedChat

## Architecture Overview

The component is a Salesforce LWC (Lightning Web Component) that embeds Agentforce chat inline within an Experience Cloud page. Key aspects include:

- **Eager bootstrap loading** -- The Salesforce Embedded Messaging SDK loads on `connectedCallback` with `disableInlineAutoLaunch = true`, so no session starts until the user submits
- **User-triggered sessions** -- Sessions begin when users submit questions via `launchChat()`, followed by `sendTextMessage()`
- **Session resumption** -- Existing sessions are automatically detected and resumed on page reload via the bootstrap's own localStorage check
- **Finite state machine** -- Eight states and twelve events control UI transitions, timer management, and event handling via an explicit transition table
- **Crossfade transitions** -- CSS opacity and transform transitions move between prompt and chat layers
- **Auto-growing textarea** -- Input uses a `<textarea rows="1">` that auto-grows up to ~5 lines (8rem), then scrolls. Enter submits, Shift+Enter inserts a newline. Submit button alignment switches from centered to bottom-aligned when content becomes multiline
- **Minimum chat height** -- `chatHeight` is enforced to a minimum of 400px (for `px` values) to prevent layout breakage
- **Canned prompts** -- Configurable quick-action buttons driven by custom labels, gated behind a `showCannedPrompts` property
- **Performance instrumentation** -- Optional Performance API timing (gated behind `enableDebugLogs`) measures submit-to-active duration and stores results in localStorage. Click the version badge to view a summary overlay with median, avg, min/max, and p95

## Component Properties

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `orgId` | String | -- | 18-character Salesforce Org ID from the deployment Code Snippet |
| `deploymentApiName` | String | -- | Embedded Service Deployment API Name from the Code Snippet |
| `siteUrl` | String | -- | Experience Cloud site base URL (no trailing slash) |
| `scrt2Url` | String | `""` | SCRT URL from the Code Snippet (optional) |
| `bootstrapScriptUrl` | String | `""` | Override URL for the bootstrap script (auto-derived from Site URL if blank) |
| `chatHeight` | String | `"550px"` | CSS height of the chat container. Minimum 400px |
| `enableDebugLogs` | Boolean | `false` | Logs lifecycle events and perf timing to the browser console |
| `showCannedPrompts` | Boolean | `false` | Show canned prompt buttons sourced from custom labels. Set a label to `skip` to hide that button |

## State Machine

| State | User Sees | What Is Happening |
|-------|-----------|-------------------|
| PROMPT | Heading + textarea + canned prompts | Initial state, bootstrap not yet loaded |
| PRIMED | Heading + textarea + canned prompts | Bootstrap ready (`Ready` + `ButtonCreated` received), awaiting user action |
| READY | Heading + textarea + canned prompts | Conversation opened (prelaunch or session resumption), awaiting user submit |
| LOADING | Skeleton loader (crossfade from prompt) | User submitted; bootstrap loading, waiting for `BOOTSTRAP_READY` |
| LAUNCHING | Skeleton loader | `utilAPI.launchChat()` called, waiting for `ConversationOpened` event |
| SENDING | Skeleton loader | Conversation opened, waiting for `FirstBotMessageSent`, then `sendTextMessage()` |
| ACTIVE | Chat iframe (crossfade from skeleton) | Message sent, iframe polled and revealed, timers cleared |
| ERROR | Error message + "Try again" | Failure occurred (timeout, init error, API rejection) |

### Transition Table

```
PROMPT:
  BOOTSTRAP_READY  -> PRIMED
  SUBMIT           -> LOADING
  CONV_OPENED      -> READY
  SESSION_ACTIVE   -> ACTIVE
  INIT_ERROR       -> ERROR

PRIMED:
  SUBMIT           -> LAUNCHING
  CONV_OPENED      -> READY      (session resumption detected here)
  SESSION_ACTIVE   -> ACTIVE
  INIT_ERROR       -> ERROR

READY:
  SUBMIT           -> SENDING
  SESSION_ACTIVE   -> ACTIVE     (dispatched automatically on session resumption)
  CONV_CLOSED      -> PROMPT
  INIT_ERROR       -> ERROR
  TIMEOUT          -> ERROR

LOADING:
  BOOTSTRAP_READY  -> LAUNCHING
  CONV_OPENED      -> SENDING
  INIT_ERROR       -> ERROR
  TIMEOUT          -> ERROR

LAUNCHING:
  CONV_OPENED      -> SENDING
  LAUNCH_FALLBACK  -> ACTIVE
  INIT_ERROR       -> ERROR
  TIMEOUT          -> ERROR

SENDING:
  BOT_MESSAGE      -> SENDING    (self-transition, retries sendTextMessage)
  MSG_SENT         -> ACTIVE
  SEND_FALLBACK    -> SENDING    (self-transition, retries sendTextMessage)
  TIMEOUT          -> ERROR

ACTIVE:
  CONV_CLOSED      -> PROMPT     (only from WindowClosed, not ConversationClosed)
  CONV_OPENED      -> ACTIVE     (self-transition, user clicked "New Conversation" in iframe)

ERROR:
  RETRY            -> PROMPT
```

### Prompt States

PROMPT, PRIMED, and READY are collectively treated as "prompt states" (`isPrompt` returns `true`). In these states the prompt layer is visible and the chat layer is hidden. All other states show the chat layer.

### Session Resumption Flow

When the page reloads with an existing session in localStorage:

1. `connectedCallback` -> `_loadBootstrapScript()` (always runs)
2. Bootstrap detects existing session and auto-resumes it
3. `Ready` + `ButtonCreated` fire -> `PROMPT -> PRIMED`
4. `ConversationOpened` fires -> `PRIMED -> READY`
5. No `_pendingQuery` + state is READY -> dispatches `SESSION_ACTIVE`
6. `READY -> ACTIVE` -> `_revealChat()` shows the existing chat

## Salesforce Bootstrap Events

| Event | Triggers | Component Action |
|-------|----------|------------------|
| `onEmbeddedMessagingReady` | Bootstrap initialized | Sets `_readySeen`, calls `_checkBootstrapReady()` |
| `onEmbeddedMessagingButtonCreated` | Chat button created | Sets `_buttonCreatedSeen`, hides FAB, calls `_checkBootstrapReady()` |
| `onEmbeddedMessagingInitError` | Init failed | Dispatches `INIT_ERROR` with error detail |
| `onEmbeddedMessagingConversationOpened` | Chat session active | Dispatches `CONV_OPENED`; starts send fallback or triggers session resumption |
| `onEmbeddedMessagingFirstBotMessageSent` | Agent welcome sent | Dispatches `BOT_MESSAGE`; triggers `sendTextMessage()` with pending query |
| `onEmbeddedMessagingSessionStatusUpdate` | Session status changed | Dispatches `SESSION_ACTIVE` if status is `"Active"` |
| `onEmbeddedMessagingConversationClosed` | Conversation ended | Logged only — chat layer stays visible so user can click "New Conversation" in the iframe |
| `onEmbeddedMessagingWindowClosed` | Chat window closed | Dispatches `CONV_CLOSED`; soft resets to PROMPT |

## Timers & Fallbacks

| Timer | Duration | When Started | Action on Fire |
|-------|----------|--------------|----------------|
| Overall timeout | 30s | `handleSubmit` | Dispatches `TIMEOUT` -> ERROR state |
| Launch fallback | 8s | After `launchChat()` resolves | Dispatches `LAUNCH_FALLBACK` -> ACTIVE if `ConversationOpened` hasn't fired |
| Send fallback | 15s | On `CONV_OPENED` with pending query | Dispatches `SEND_FALLBACK` -> retries `sendTextMessage()` |
| Iframe poll | 120ms interval | `_revealChat()` in ACTIVE state | Checks iframe dimensions (>=250x300); reveals when ready (max 6s) |
| Retry delay | 500ms | `launchChat` / `sendTextMessage` failure | Single retry before falling through |

## Bootstrap Configuration

| Setting | Value | Purpose |
|---------|-------|---------|
| `language` | `"en_US"` | UI language |
| `displayMode` | `"inline"` | Render inside target element (not popup) |
| `disableInlineAutoLaunch` | `true` | Load and prime only -- session starts explicitly via `launchChat()` |
| `targetElement` | `refs.chatContainer` | DOM element where SDK renders the chat iframe |

## Custom Labels

| Label | Purpose |
|-------|---------|
| `HAA_heading` | Main heading text |
| `HAA_input_placeholder` | Textarea placeholder |
| `HAA_input_ariaLabel` | Textarea accessibility label |
| `HAA_submit_altText` | Submit button alt text |
| `HAA_loading_altText` | Loading spinner alt text |
| `HAA_retry_label` | Retry button label |
| `HAA_error_*` | Error messages (7 variants) |
| `HAA_canned_prompt_one/two/three` | Canned prompt button labels (set to `skip` to hide) |

## Child Components

| Component | Purpose |
|-----------|---------|
| `c-haa-skeleton-loader` | Chat-style loading skeleton with `reverse` attribute for right-aligned avatar |

## Performance Instrumentation

When `enableDebugLogs` is enabled:

1. `performance.mark("HAA-submit")` placed in `handleSubmit()`
2. `performance.mark("HAA-active")` placed in `_revealChat()` -> `doReveal()`
3. Duration measured and logged as `[HAA] perf Xms to active`
4. Results appended to `localStorage.HAA_perf` (JSON array, capped at 50 entries)
5. Click the version badge to view a perf summary overlay showing: sample count, median, average, min/max, and p95. Outliers (>3x median) are filtered out to exclude runs where execution was paused for DOM inspection

## Teardown

The component uses two teardown strategies:

### Soft Reset (`_softReset`)

Used on **window close** (`onEmbeddedMessagingWindowClosed` → `CONV_CLOSED`). Clears timers, pending state, and UI (textarea value/height, search query, error message). Does **not** remove chatContainer children — the bootstrap's iframe and RPC channel must stay intact for recovery. Keeps the bootstrap alive -- event listeners, bootstrap flags (`_bootstrapInited`, `_readySeen`, `_buttonCreatedSeen`), and `_scriptLoaded` are preserved. Note: `onEmbeddedMessagingConversationClosed` does **not** trigger a reset — the chat layer stays visible so the user can click "New Conversation" in the iframe.

### Full Teardown (`_nukeBootstrap`)

Used only in **`disconnectedCallback`** when the component is destroyed. Removes event listeners, global DOM injected by the bootstrap outside the shadow DOM (FAB, overlays, iframes, styles via broad `querySelectorAll`), and resets all internal flags. This is not used on conversation close because the aggressive global DOM removal breaks recovery under Lightning Web Security (LWS), and LWS cannot be reliably detected at runtime.

## Known Issues

### Experience Builder Preview CORS Error

The Experience Builder preview domain (`*.live-preview.salesforce-experience.com`) is a different origin from the actual site (`*.my.site.com`). This causes CORS errors when the component tries to load `bootstrap.min.js`:

```
Access to fetch at '...bootstrap.min.js' from origin '...live-preview.salesforce-experience.com'
has been blocked by CORS policy
```

**Workaround:** Publish the site and test on the actual `*.my.site.com` domain. The preview environment does not fully support cross-origin embedded messaging.
