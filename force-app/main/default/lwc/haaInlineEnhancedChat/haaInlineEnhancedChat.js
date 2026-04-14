import { LightningElement, api } from "lwc";
import HAA_heading from "@salesforce/label/c.HAA_heading";
import HAA_input_placeholder from "@salesforce/label/c.HAA_input_placeholder";
import HAA_input_ariaLabel from "@salesforce/label/c.HAA_input_ariaLabel";
import HAA_submit_altText from "@salesforce/label/c.HAA_submit_altText";
import HAA_loading_altText from "@salesforce/label/c.HAA_loading_altText";
import HAA_retry_label from "@salesforce/label/c.HAA_retry_label";
import HAA_error_invalidConfig from "@salesforce/label/c.HAA_error_invalidConfig";
import HAA_error_noBootstrapUrl from "@salesforce/label/c.HAA_error_noBootstrapUrl";
import HAA_error_scriptLoadFailed from "@salesforce/label/c.HAA_error_scriptLoadFailed";
import HAA_error_noContainer from "@salesforce/label/c.HAA_error_noContainer";
import HAA_error_bootstrapUnavailable from "@salesforce/label/c.HAA_error_bootstrapUnavailable";
import HAA_error_initFailed from "@salesforce/label/c.HAA_error_initFailed";
import HAA_error_launchUnavailable from "@salesforce/label/c.HAA_error_launchUnavailable";
import HAA_error_launchFailed from "@salesforce/label/c.HAA_error_launchFailed";
import HAA_error_timeout from "@salesforce/label/c.HAA_error_timeout";
import HAA_canned_prompt_one from "@salesforce/label/c.HAA_canned_prompt_one";
import HAA_canned_prompt_two from "@salesforce/label/c.HAA_canned_prompt_two";
import HAA_canned_prompt_three from "@salesforce/label/c.HAA_canned_prompt_three";

// --- States ---
const STATE = Object.freeze({
  PROMPT: "PROMPT",
  PRIMED: "PRIMED",
  READY: "READY",
  LOADING: "LOADING",
  LAUNCHING: "LAUNCHING",
  SENDING: "SENDING",
  ACTIVE: "ACTIVE",
  ERROR: "ERROR"
});

// --- Events ---
const EVT = Object.freeze({
  SUBMIT: "SUBMIT",
  BOOTSTRAP_READY: "BOOTSTRAP_READY",
  CONV_OPENED: "CONV_OPENED",
  BOT_MESSAGE: "BOT_MESSAGE",
  MSG_SENT: "MSG_SENT",
  CONV_CLOSED: "CONV_CLOSED",
  SESSION_ACTIVE: "SESSION_ACTIVE",
  INIT_ERROR: "INIT_ERROR",
  LAUNCH_FALLBACK: "LAUNCH_FALLBACK",
  SEND_FALLBACK: "SEND_FALLBACK",
  TIMEOUT: "TIMEOUT",
  RETRY: "RETRY"
});

// --- Transition table ---
const TRANSITIONS = Object.freeze({
  [STATE.PROMPT]: {
    [EVT.CONV_OPENED]: STATE.READY,
    [EVT.SESSION_ACTIVE]: STATE.ACTIVE,
    [EVT.SUBMIT]: STATE.LOADING,
    [EVT.BOOTSTRAP_READY]: STATE.PRIMED,
    [EVT.INIT_ERROR]: STATE.ERROR
  },
  [STATE.PRIMED]: {
    [EVT.SUBMIT]: STATE.LAUNCHING,
    [EVT.CONV_OPENED]: STATE.READY,
    [EVT.SESSION_ACTIVE]: STATE.ACTIVE,
    [EVT.INIT_ERROR]: STATE.ERROR
  },
  [STATE.READY]: {
    [EVT.SUBMIT]: STATE.SENDING,
    [EVT.SESSION_ACTIVE]: STATE.ACTIVE,
    [EVT.CONV_CLOSED]: STATE.PROMPT,
    [EVT.INIT_ERROR]: STATE.ERROR,
    [EVT.TIMEOUT]: STATE.ERROR
  },
  [STATE.LOADING]: {
    [EVT.BOOTSTRAP_READY]: STATE.LAUNCHING,
    [EVT.CONV_OPENED]: STATE.SENDING,
    [EVT.INIT_ERROR]: STATE.ERROR,
    [EVT.TIMEOUT]: STATE.ERROR
  },
  [STATE.LAUNCHING]: {
    [EVT.CONV_OPENED]: STATE.SENDING,
    [EVT.LAUNCH_FALLBACK]: STATE.ACTIVE,
    [EVT.INIT_ERROR]: STATE.ERROR,
    [EVT.TIMEOUT]: STATE.ERROR
  },
  // BOT_MESSAGE and SEND_FALLBACK are self-transitions: they keep the
  // state as SENDING but trigger side effects (retry sending the message).
  [STATE.SENDING]: {
    [EVT.BOT_MESSAGE]: STATE.SENDING,
    [EVT.MSG_SENT]: STATE.ACTIVE,
    [EVT.SEND_FALLBACK]: STATE.SENDING,
    [EVT.TIMEOUT]: STATE.ERROR
  },
  [STATE.ACTIVE]: {
    [EVT.CONV_CLOSED]: STATE.PROMPT,
    [EVT.CONV_OPENED]: STATE.ACTIVE
  },
  [STATE.ERROR]: {
    [EVT.RETRY]: STATE.PROMPT
  }
});

// --- Constants ---
const DEFAULT_TIMEOUT_MS = 30000;
const RETRY_DELAY_MS = 500;
const LAUNCH_FALLBACK_MS = 8000;
const SEND_FALLBACK_MS = 15000;
const IFRAME_POLL_MS = 120;
const IFRAME_MAX_WAIT_MS = 6000;
const DEFAULT_CHAT_HEIGHT = "550px";
const MIN_CHAT_HEIGHT_PX = 400;
const VERSION = "v1.03";

export default class HaaInlineEnhancedChat extends LightningElement {
  @api orgId;
  @api deploymentApiName;
  @api siteUrl;
  @api scrt2Url = "";
  @api bootstrapScriptUrl = "";
  @api chatHeight = "550px";
  @api enableDebugLogs = false;
  @api showCannedPrompts = false;

  timeoutMs = DEFAULT_TIMEOUT_MS;
  searchQuery = "";
  errorMessage = "";

  _state = STATE.PROMPT;
  _pendingQuery = "";
  _scriptLoaded = false;
  _bootstrapInited = false;
  _listenersAttached = false;
  _readySeen = false;
  _buttonCreatedSeen = false;
  _timeoutId = null;
  _iframePollId = null;
  _revealTimeoutId = null;
  _launchFallbackId = null;
  _sendFallbackId = null;
  _chatRevealed = false;
  _boundListeners = {};

  // --- Computed properties ---

  get isPrompt() {
    return (
      this._state === STATE.PROMPT ||
      this._state === STATE.PRIMED ||
      this._state === STATE.READY
    );
  }

  get isChatActive() {
    return !this.isPrompt;
  }

  get isLoading() {
    if ([STATE.LOADING, STATE.LAUNCHING, STATE.SENDING].includes(this._state))
      return true;
    if (this._state === STATE.ACTIVE && !this._chatRevealed) return true;
    return false;
  }

  get isError() {
    return this._state === STATE.ERROR;
  }

  _isMultiline = false;

  get inputRowClass() {
    const align = this._isMultiline
      ? "slds-grid_vertical-align-end"
      : "slds-grid_vertical-align-center";
    return `input-row slds-grid ${align}`;
  }

  get isSubmitDisabled() {
    return !this.searchQuery.trim();
  }

  get submitBtnClass() {
    return `submit-btn slds-var-m-left_x-small${this.isSubmitDisabled ? " submit-btn-disabled" : ""}`;
  }

  get promptLayerClass() {
    return `prompt-layer${this.isChatActive ? " prompt-hidden" : ""}`;
  }

  get chatLayerClass() {
    let cls = "chat-layer";
    if (this._state !== STATE.PROMPT) cls += " chat-bordered";
    if (this.isChatActive) cls += " chat-active";
    return cls;
  }

  get containerStyle() {
    const h = this._sanitizeCssLength(this.chatHeight);
    return `height: ${h}; min-height: ${h};`;
  }

  _sanitizeCssLength(value) {
    if (!/^\d+(px|rem|em|vh|%)$/.test(value)) return DEFAULT_CHAT_HEIGHT;
    const match = value.match(/^(\d+)px$/);
    if (match && parseInt(match[1], 10) < MIN_CHAT_HEIGHT_PX) {
      return MIN_CHAT_HEIGHT_PX + "px";
    }
    return value;
  }

  labels = {
    HAA_heading,
    HAA_input_placeholder,
    HAA_input_ariaLabel,
    HAA_submit_altText,
    HAA_loading_altText,
    HAA_retry_label,
    HAA_error_invalidConfig,
    HAA_error_noBootstrapUrl,
    HAA_error_scriptLoadFailed,
    HAA_error_noContainer,
    HAA_error_bootstrapUnavailable,
    HAA_error_initFailed,
    HAA_error_launchUnavailable,
    HAA_error_launchFailed,
    HAA_error_timeout,
    HAA_canned_prompt_one,
    HAA_canned_prompt_two,
    HAA_canned_prompt_three
  };

  get _isCannedPromptsEnabled() {
    return this.showCannedPrompts === true || this.showCannedPrompts === "true";
  }

  get cannedPrompts() {
    if (!this._isCannedPromptsEnabled) return [];
    return [
      HAA_canned_prompt_one,
      HAA_canned_prompt_two,
      HAA_canned_prompt_three
    ].filter(
      (label) =>
        label &&
        label.trim().length > 0 &&
        label.trim().toLowerCase() !== "skip"
    );
  }

  get hasCannedPrompts() {
    return this.cannedPrompts.length > 0;
  }

  get isDebug() {
    return this.enableDebugLogs === true || this.enableDebugLogs === "true";
  }

  get version() {
    return VERSION;
  }

  get bootstrapUrl() {
    if (this.bootstrapScriptUrl) return this.bootstrapScriptUrl;
    if (this.siteUrl) {
      const base = this.siteUrl.replace(/\/$/, "");
      return `${base}/assets/js/bootstrap.min.js`;
    }
    return "";
  }

  // --- Lifecycle ---
  //
  // Session resumption (not currently implemented):
  // Salesforce stores active session data in localStorage under the key
  // `{orgId}_CWC_WEB_STORAGE` (e.g. "00DHu00000yuC7F_CWC_WEB_STORAGE").
  // To resume sessions on page reload, you could check for this key here
  // and call _loadBootstrapScript() if found. The FSM already supports this
  // via PROMPT + SESSION_ACTIVE → ACTIVE and PROMPT + CONV_OPENED → READY.
  // Disabled because: (1) the key format is undocumented and could change,
  // (2) loading the bootstrap preloads the agent chat in the background.

  connectedCallback() {
    this._debug("version", VERSION);
    if (this._hasValidConfig()) {
      this._loadBootstrapScript();
    }
  }

  disconnectedCallback() {
    this._nukeBootstrap();
  }

  // --- FSM core ---

  _dispatch(event, data) {
    const nextState = TRANSITIONS[this._state]?.[event];
    if (!nextState) {
      this._debug("ignored", `${event} in ${this._state}`);
      return;
    }
    const prev = this._state;
    this._state = nextState;
    this._debug("state", `${prev} -> ${nextState} [${event}]`);
    this._onTransition(event, data);
  }

  _onTransition(event, data) {
    switch (event) {
      case EVT.SUBMIT:
        this._chatRevealed = false;
        this._startTimeout();
        if (this._state === STATE.SENDING) {
          // Came from READY — conversation already open, send immediately
          this._startSendFallback();
          this._trySendMessage(this._pendingQuery);
        } else if (this._state === STATE.LAUNCHING) {
          // Came from PRIMED — bootstrap ready, launch chat
          this._tryLaunchChat();
        } else if (this._bootstrapInited) {
          if (this._readySeen && this._buttonCreatedSeen) {
            this._dispatch(EVT.BOOTSTRAP_READY);
          }
        } else {
          this._loadBootstrapScript();
        }
        break;

      case EVT.BOOTSTRAP_READY:
        if (this._state === STATE.LAUNCHING) {
          this._tryLaunchChat();
        }
        break;

      case EVT.CONV_OPENED:
        this._clearLaunchFallback();
        if (this._pendingQuery) {
          this._startSendFallback();
        } else if (this._state === STATE.READY) {
          // Session resumption — bootstrap auto-restored an existing session.
          // Skip to ACTIVE so the chat is revealed instead of hidden behind prompt.
          this._dispatch(EVT.SESSION_ACTIVE);
        }
        break;

      case EVT.BOT_MESSAGE:
        this._clearSendFallback();
        if (this._pendingQuery) {
          this._trySendMessage(this._pendingQuery);
        }
        break;

      case EVT.SEND_FALLBACK:
        if (this._pendingQuery) {
          this._trySendMessage(this._pendingQuery);
        }
        break;

      case EVT.MSG_SENT:
        this._pendingQuery = "";
        this._clearTimers();
        this._revealChat();
        break;

      case EVT.LAUNCH_FALLBACK:
        this._pendingQuery = "";
        this._clearTimers();
        this._revealChat();
        break;

      case EVT.SESSION_ACTIVE:
        this._clearTimers();
        this._revealChat();
        break;

      case EVT.CONV_CLOSED:
        this._softReset();
        break;

      case EVT.INIT_ERROR:
        this.errorMessage =
          data?.message || this.labels.HAA_error_initFailed;
        this._clearTimers();
        break;

      case EVT.TIMEOUT:
        this.errorMessage = this.labels.HAA_error_timeout;
        this._clearTimers();
        break;

      case EVT.RETRY:
        this._clearTimers();
        this._pendingQuery = "";
        this.errorMessage = "";
        this._chatRevealed = false;
        break;

      default:
        break;
    }
  }

  // --- User interaction ---

  perfSummary = "";

  handleVersionClick() {
    if (this.perfSummary) {
      this.perfSummary = "";
      return;
    }
    try {
      const raw = JSON.parse(localStorage.getItem("HAA_perf") || "[]");
      if (!raw.length) {
        this.perfSummary = "No perf data";
        return;
      }
      const sorted = raw.map((r) => r.duration).sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      // Discard outliers > 3x median (likely paused for DOM inspection)
      const clean = sorted.filter((d) => d <= median * 3);
      if (!clean.length) {
        this.perfSummary = "All entries filtered as outliers";
        return;
      }
      const avg = Math.round(clean.reduce((s, d) => s + d, 0) / clean.length);
      const min = clean[0];
      const max = clean[clean.length - 1];
      const p95 = clean[Math.floor(clean.length * 0.95)];
      const lines = [
        "submit -> active",
        `samples : ${clean.length}/${raw.length}`,
        `median  : ${median}ms`,
        `avg     : ${avg}ms`,
        `min/max : ${min}/${max}ms`,
        `p95     : ${p95}ms`
      ];
      this.perfSummary = lines.join("\n");
    } catch {
      this.perfSummary = "Error reading perf data";
    }
  }

  closePerfOverlay() {
    this.perfSummary = "";
  }

  handleQueryChange(event) {
    this.searchQuery = event.target.value;
    this._autoResize(event.target);
  }

  handleKeyDown(event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      this.handleSubmit();
    }
  }

  _autoResize(textarea) {
    textarea.style.height = "auto";
    textarea.style.height = textarea.scrollHeight + "px";
    textarea.style.overflow =
      textarea.scrollHeight > textarea.offsetHeight ? "auto" : "hidden";
    const style = getComputedStyle(textarea);
    const lineHeight = parseFloat(style.lineHeight) || 24;
    const paddingTop = parseFloat(style.paddingTop) || 0;
    const paddingBottom = parseFloat(style.paddingBottom) || 0;
    const contentHeight = textarea.scrollHeight - paddingTop - paddingBottom;
    this._isMultiline = Math.round(contentHeight / lineHeight) > 1;
  }

  handleCannedPrompt(event) {
    const query = event.currentTarget.dataset.query;
    if (!query) return;
    this.searchQuery = query;
    this.handleSubmit();
  }

  handleSubmit() {
    const query = (this.searchQuery || "").trim();
    if (!query) return;

    if (!this._hasValidConfig()) {
      this._dispatch(EVT.INIT_ERROR, {
        message: this.labels.HAA_error_invalidConfig
      });
      return;
    }

    if (this.isDebug) performance.mark("HAA-submit");
    this._pendingQuery = query;
    this.errorMessage = "";
    this._dispatch(EVT.SUBMIT);
  }

  handleRetry() {
    this._dispatch(EVT.RETRY);
  }

  // --- Bootstrap loading ---

  _loadBootstrapScript() {
    if (this._scriptLoaded) {
      if (typeof window.embeddedservice_bootstrap !== "undefined") {
        this._initChat();
      }
      return;
    }

    const url = this.bootstrapUrl;
    if (!url) {
      this._dispatch(EVT.INIT_ERROR, {
        message: this.labels.HAA_error_noBootstrapUrl
      });
      return;
    }

    const script = document.createElement("script");
    script.src = url;
    script.defer = true;
    script.onload = () => {
      this._scriptLoaded = true;
      this._initChat();
    };
    script.onerror = () => {
      this._dispatch(EVT.INIT_ERROR, {
        message: this._isSitePreview()
          ? "Chat is not available in Experience Builder preview. Publish the site to test."
          : this.labels.HAA_error_scriptLoadFailed
      });
    };
    document.body.appendChild(script);
  }

  // --- Chat initialization ---

  _initChat() {
    if (this._bootstrapInited) return;

    const chatElement = this.refs.chatContainer;
    if (!chatElement) {
      this._dispatch(EVT.INIT_ERROR, {
        message: this.labels.HAA_error_noContainer
      });
      return;
    }

    if (typeof window.embeddedservice_bootstrap === "undefined") {
      this._dispatch(EVT.INIT_ERROR, {
        message: this.labels.HAA_error_bootstrapUnavailable
      });
      return;
    }

    const bootstrap = window.embeddedservice_bootstrap;
    bootstrap.settings.language = "en_US";
    bootstrap.settings.displayMode = "inline";
    bootstrap.settings.disableInlineAutoLaunch = true;
    bootstrap.settings.targetElement = chatElement;

    this._attachListeners();

    this._bootstrapInited = true;
    const initOptions = this.scrt2Url ? { scrt2URL: this.scrt2Url } : {};
    bootstrap.init(
      this.orgId,
      this.deploymentApiName,
      this.siteUrl,
      initOptions
    );
  }

  // --- Event listeners ---

  _attachListeners() {
    if (this._listenersAttached) return;
    this._listenersAttached = true;

    const events = {
      onEmbeddedMessagingReady: () => this._onReady(),
      onEmbeddedMessagingButtonCreated: () => this._onButtonCreated(),
      onEmbeddedMessagingInitError: (e) => this._dispatch(EVT.INIT_ERROR, e),
      onEmbeddedMessagingConversationOpened: () =>
        this._dispatch(EVT.CONV_OPENED),
      onEmbeddedMessagingFirstBotMessageSent: () =>
        this._dispatch(EVT.BOT_MESSAGE),
      onEmbeddedMessagingSessionStatusUpdate: (e) => this._onSessionStatus(e),
      onEmbeddedMessagingConversationClosed: () =>
        this._debug("event", "ConversationClosed (staying on chat)"),
      onEmbeddedMessagingWindowClosed: () => this._dispatch(EVT.CONV_CLOSED)
    };

    for (const [event, handler] of Object.entries(events)) {
      this._boundListeners[event] = handler;
      window.addEventListener(event, handler);
    }
  }

  _removeListeners() {
    for (const [event, handler] of Object.entries(this._boundListeners)) {
      window.removeEventListener(event, handler);
    }
    this._boundListeners = {};
  }

  // --- Event handlers ---

  _onReady() {
    this._debug("event", "Ready");
    this._readySeen = true;
    this._checkBootstrapReady();
  }

  _onButtonCreated() {
    this._debug("event", "ButtonCreated");
    this._buttonCreatedSeen = true;
    this._hideFab();
    this._checkBootstrapReady();
  }

  _checkBootstrapReady() {
    if (this._readySeen && this._buttonCreatedSeen) {
      this._dispatch(EVT.BOOTSTRAP_READY);
    }
  }

  _onSessionStatus(event) {
    const status = event?.detail?.status || event?.detail?.sessionStatus || "";
    this._debug("event", `SessionStatus: ${status}`);
    if (status === "Active") {
      this._dispatch(EVT.SESSION_ACTIVE);
    }
  }

  // --- API calls with retry ---

  _tryLaunchChat(isRetry = false) {
    const bootstrap = window.embeddedservice_bootstrap;

    if (!bootstrap?.utilAPI?.launchChat) {
      this._debug("warn", "launchChat not available");
      if (!isRetry) {
        setTimeout(() => this._tryLaunchChat(true), RETRY_DELAY_MS);
      } else {
        this._dispatch(EVT.INIT_ERROR, {
          message: this.labels.HAA_error_launchUnavailable
        });
      }
      return;
    }

    bootstrap.utilAPI
      .launchChat()
      .then(() => {
        this._debug("api", "launchChat resolved");
        this._startLaunchFallback();
      })
      .catch((err) => {
        this._debug("api", `launchChat rejected: ${err}`);
        if (!isRetry) {
          setTimeout(() => this._tryLaunchChat(true), RETRY_DELAY_MS);
        } else {
          this._dispatch(EVT.INIT_ERROR, {
            message: this.labels.HAA_error_launchFailed
          });
        }
      });
  }

  _trySendMessage(text, isRetry = false) {
    const bootstrap = window.embeddedservice_bootstrap;

    if (!bootstrap?.utilAPI?.sendTextMessage) {
      this._debug("warn", "sendTextMessage not available");
      if (!isRetry) {
        setTimeout(() => this._trySendMessage(text, true), RETRY_DELAY_MS);
      } else {
        this._debug(
          "warn",
          "sendTextMessage unavailable after retry, proceeding to ACTIVE"
        );
        this._dispatch(EVT.MSG_SENT);
      }
      return;
    }

    bootstrap.utilAPI
      .sendTextMessage(text)
      .then(() => {
        this._debug("api", "sendTextMessage resolved");
        this._dispatch(EVT.MSG_SENT);
      })
      .catch((err) => {
        this._debug("api", `sendTextMessage rejected: ${err}`);
        if (!isRetry) {
          setTimeout(() => this._trySendMessage(text, true), RETRY_DELAY_MS);
        } else {
          this._debug(
            "warn",
            "sendTextMessage failed after retry, proceeding to ACTIVE"
          );
          this._dispatch(EVT.MSG_SENT);
        }
      });
  }

  // --- FAB hiding ---

  _hideFab() {
    try {
      const bootstrap = window.embeddedservice_bootstrap;
      if (bootstrap?.utilAPI?.hideChatButton) {
        bootstrap.utilAPI.hideChatButton();
      }
    } catch (e) {
      // hideChatButton may not be available yet
    }
  }

  // --- reveal ---

  _revealChat() {
    if (this._iframePollId || this._chatRevealed) return;

    const chatElement = this.refs.chatContainer;
    if (!chatElement) {
      this._chatRevealed = true;
      return;
    }

    const doReveal = () => {
      this._chatRevealed = true;
      this._clearIframePoll();
      if (this.isDebug) {
        performance.mark("HAA-active");
        try {
          const m = performance.measure(
            "HAA-time-to-active",
            "HAA-submit",
            "HAA-active"
          );
          this._debug("perf", `${Math.round(m.duration)}ms to active`);
          const history = JSON.parse(
            localStorage.getItem("HAA_perf") || "[]"
          );
          history.push({
            duration: Math.round(m.duration),
            timestamp: Date.now()
          });
          if (history.length > 50) history.shift();
          localStorage.setItem("HAA_perf", JSON.stringify(history));
        } catch (e) {
          /* marks may not exist if submit was skipped */
        }
        performance.clearMarks("HAA-submit");
        performance.clearMarks("HAA-active");
      }
    };

    const tryReveal = () => {
      const iframe = chatElement.querySelector("iframe");
      if (iframe && iframe.offsetWidth >= 250 && iframe.offsetHeight >= 300) {
        doReveal();
      }
    };

    this._iframePollId = setInterval(tryReveal, IFRAME_POLL_MS);

    this._revealTimeoutId = setTimeout(() => {
      if (!this._chatRevealed) doReveal();
    }, IFRAME_MAX_WAIT_MS);
  }

  // --- Timers ---

  _startTimeout() {
    this._clearTimeout();
    this._timeoutId = setTimeout(
      () => this._dispatch(EVT.TIMEOUT),
      Number(this.timeoutMs) || DEFAULT_TIMEOUT_MS
    );
  }

  _startLaunchFallback() {
    this._clearLaunchFallback();
    this._launchFallbackId = setTimeout(
      () => this._dispatch(EVT.LAUNCH_FALLBACK),
      LAUNCH_FALLBACK_MS
    );
  }

  _startSendFallback() {
    this._clearSendFallback();
    this._sendFallbackId = setTimeout(
      () => this._dispatch(EVT.SEND_FALLBACK),
      SEND_FALLBACK_MS
    );
  }

  _clearTimers() {
    this._clearTimeout();
    this._clearIframePoll();
    this._clearLaunchFallback();
    this._clearSendFallback();
  }

  _clearTimeout() {
    if (this._timeoutId) {
      clearTimeout(this._timeoutId);
      this._timeoutId = null;
    }
  }

  _clearIframePoll() {
    if (this._iframePollId) {
      clearInterval(this._iframePollId);
      this._iframePollId = null;
    }
    if (this._revealTimeoutId) {
      clearTimeout(this._revealTimeoutId);
      this._revealTimeoutId = null;
    }
  }

  _clearLaunchFallback() {
    if (this._launchFallbackId) {
      clearTimeout(this._launchFallbackId);
      this._launchFallbackId = null;
    }
  }

  _clearSendFallback() {
    if (this._sendFallbackId) {
      clearTimeout(this._sendFallbackId);
      this._sendFallbackId = null;
    }
  }

  // --- Bootstrap teardown ---

  _softReset() {
    this._debug("teardown", "soft reset");
    this._clearTimers();
    this._pendingQuery = "";
    this._chatRevealed = false;
    this._isMultiline = false;
    this.searchQuery = "";
    this.errorMessage = "";
    const textarea = this.refs.searchInput;
    if (textarea) {
      textarea.value = "";
      textarea.style.height = "";
    }
  }

  // Full teardown: removes event listeners, global DOM injected by the
  // bootstrap (FAB, overlays, iframes, styles), and resets all bootstrap
  // flags so the next interaction re-initialises from scratch. Only used
  // in disconnectedCallback when the component is destroyed. Not used on
  // conversation close because the aggressive global DOM removal breaks
  // recovery under Lightning Web Security (LWS), and LWS cannot be
  // reliably detected at runtime.
  _nukeBootstrap() {
    this._clearTimers();
    this._removeListeners();

    const chatElement = this.refs.chatContainer;
    if (chatElement) {
      while (chatElement.firstChild) {
        chatElement.removeChild(chatElement.firstChild);
      }
    }

    // Remove DOM the bootstrap injected outside our shadow DOM (FAB, overlays,
    // modals, iframes, styles). Warning: this broad selector will also remove
    // elements from other components using the same bootstrap on the page.
    // Salesforce does not provide a scoped teardown API.
    document
      .querySelectorAll(
        '[class*="embeddedMessaging"], [class*="embedded-messaging"], [id*="embeddedMessaging"]'
      )
      .forEach((el) => {
        if (!this.template.contains(el)) {
          el.remove();
        }
      });

    this._bootstrapInited = false;
    this._readySeen = false;
    this._buttonCreatedSeen = false;
    this._listenersAttached = false;
    this._pendingQuery = "";
    this._chatRevealed = false;
    this._isMultiline = false;
    this.searchQuery = "";
    this.errorMessage = "";
    const textarea = this.refs.searchInput;
    if (textarea) {
      textarea.value = "";
      textarea.style.height = "";
    }
  }

  // --- Validation ---

  _hasValidConfig() {
    return !!(
      this.orgId &&
      this.deploymentApiName &&
      this.siteUrl &&
      this.bootstrapUrl
    );
  }

  _isSitePreview() {
    return [
      "sitepreview",
      "livepreview",
      "live-preview",
      "live.",
      ".builder."
    ].some((s) => document.URL.includes(s));
  }

  // --- Debug ---

  _debug(label, detail) {
    if (this.isDebug) {
      console.log("[HAA]", label, detail || ""); // eslint-disable-line no-console
    }
  }
}
