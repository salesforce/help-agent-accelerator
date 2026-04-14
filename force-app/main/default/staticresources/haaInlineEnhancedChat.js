/*
 * Copyright 2026 Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 *
 * Agentforce Inline Chat — embed Salesforce Agentforce chat on any website.
 * Single file, no dependencies, plain JavaScript (ES2015+).
 *
 * Usage:
 *   Auto-init:  <div id="chat" data-org-id="..." data-deployment="..." data-site-url="..."></div>
 *               <script src="enhanced-chat-inline.js" data-target="chat"></script>
 *
 *   Explicit:   EnhancedChatInline.init({ containerId: 'chat', orgId: '...', deploymentApiName: '...', siteUrl: '...', scrt2Url: '' })
 */
(function () {
  'use strict';

  var STATE = Object.freeze({
    INIT: 'INIT',
    PROMPT: 'PROMPT',
    PRIMED: 'PRIMED',
    READY: 'READY',
    LOADING: 'LOADING',
    LAUNCHING: 'LAUNCHING',
    SENDING: 'SENDING',
    ACTIVE: 'ACTIVE',
    ERROR: 'ERROR'
  });

  var VERSION = '1.0.0';
  var DEFAULT_TIMEOUT_MS = 30000;
  var RETRY_DELAY_MS = 500;
  var LAUNCH_FALLBACK_MS = 8000;
  var SEND_DELAY_MS = 500;
  var SEND_FALLBACK_MS = 15000;
  var IFRAME_POLL_MS = 120;
  var IFRAME_MAX_WAIT_MS = 6000;
  var INIT_FALLBACK_MS = 5000;
  var DEFAULT_HEADING = 'How can we help?';
  var DEFAULT_PLACEHOLDER = 'Type your question here...';

  var MAX_QUERY_LENGTH = 1000;

  var TRUSTED_SF_DOMAINS = [
    '.my.site.com',
    '.salesforce.com',
    '.force.com',
    '.salesforce-scrt.com'
  ];

  function isTrustedSalesforceUrl(url) {
    try {
      var parsed = new URL(url);
      if (parsed.protocol !== 'https:') return false;
      for (var i = 0; i < TRUSTED_SF_DOMAINS.length; i++) {
        if (parsed.hostname.endsWith(TRUSTED_SF_DOMAINS[i])) return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  function createArrowSvg() {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2.5');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    var line = document.createElementNS(ns, 'line');
    line.setAttribute('x1', '12'); line.setAttribute('y1', '19');
    line.setAttribute('x2', '12'); line.setAttribute('y2', '5');
    var polyline = document.createElementNS(ns, 'polyline');
    polyline.setAttribute('points', '5 12 12 5 19 12');
    svg.appendChild(line);
    svg.appendChild(polyline);
    return svg;
  }

  var scriptLoaded = false;
  var stylesInjected = false;

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;
    var style = document.createElement('style');
    style.id = 'sfui-inline-styles';
    style.textContent = [
      '.sfui-wrapper{position:relative;width:100%;height:550px;min-height:550px;font-family:inherit;color:inherit;overflow:hidden}',
      '.sfui-prompt-phase{position:absolute;inset:0;z-index:2;display:flex;justify-content:center;align-items:flex-start;padding:2.5rem 1rem 3rem;opacity:1;transform:scale(1);transition:opacity 0.35s ease,transform 0.35s ease}',
      '.sfui-prompt-phase.sfui-prompt-hidden{opacity:0;transform:scale(0.97);pointer-events:none}',
      '.sfui-search-card{width:80%;max-width:80%;padding:2rem 0}',
      '.sfui-heading{font-size:2rem;font-weight:700;line-height:1.25;margin:0 0 1.5rem;letter-spacing:-0.01em;color:#032D60}',
      '.sfui-input-row{display:flex;align-items:center;border:1px solid var(--sfui-border,#c9c9c9);border-radius:0.25rem;background:var(--sfui-surface,#fff);padding:0.25rem 0.5rem;box-shadow:0 1px 2px rgba(0,0,0,0.05)}',
      '.sfui-input-row:focus-within{border-color:var(--sfui-brand,#1b96ff);box-shadow:0 0 0 1px var(--sfui-brand,#1b96ff)}',
      '.sfui-input{flex:1;min-width:0;border:none;outline:none;background:transparent;font:inherit;font-size:1rem;color:inherit;padding:0.5rem 0.25rem;line-height:1.5}',
      '.sfui-input::placeholder{color:currentColor;opacity:0.5}',
      '.sfui-submit-btn{flex-shrink:0;margin-left:0.5rem;width:2rem;height:2rem;border:none;border-radius:50%;background:var(--sfui-brand,#1b96ff);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0}',
      '.sfui-submit-btn:hover{background:var(--sfui-brand-hover,#0176d3)}',
      '.sfui-submit-btn:disabled{opacity:0.4;cursor:default;pointer-events:none}',
      '.sfui-submit-btn svg{width:1rem;height:1rem}',
      '.sfui-chat-wrapper{position:absolute;inset:0;z-index:1;display:flex;flex-direction:column;width:100%;overflow:hidden;opacity:0;transform:scale(1.03);transition:opacity 0.35s ease,transform 0.35s ease}',
      '.sfui-chat-wrapper.sfui-chat-visible{opacity:1;transform:scale(1)}',
      '.sfui-chat-container{flex:1;width:100%;min-height:0}',
      '.sfui-loading{position:absolute;inset:0;z-index:2;display:flex;flex-direction:column;align-items:flex-start;justify-content:flex-start;padding:2.5rem 10% 2rem;background:var(--sfui-surface,#fff)}',
      '.sfui-loading-heading{font-size:2rem;font-weight:700;line-height:1.25;margin:0 0 2rem;letter-spacing:-0.01em;color:#032D60}',
      '.sfui-skel-row{display:flex;width:80%}',
      '.sfui-skel-left{justify-content:flex-start}',
      '.sfui-skel-right{margin-top:1.5rem;margin-left:auto}',
      '.sfui-skel-wrap{display:flex;align-items:flex-start;gap:12px;width:100%;padding:0 1rem}',
      '.sfui-skel-wrap-rev{flex-direction:row-reverse}',
      '.sfui-skel-avatar{flex-shrink:0;width:32px;height:32px;border-radius:50%;background:#b8bae8}',
      '.sfui-skel-lines{display:flex;flex-direction:column;gap:12px;width:100%;max-width:100%}',
      '.sfui-skel-bar{height:16px;border-radius:24px;width:100%;background:linear-gradient(110deg,#b8bae8 25%,#7b7fc4 50%,#b8bae8 75%);background-size:400% 100%;animation:sfui-shimmer 1.8s linear infinite}',
      '.sfui-skel-bar-short{width:66%}',
      '@keyframes sfui-shimmer{0%{background-position:100% 0}100%{background-position:-100% 0}}',
      '.sfui-error{position:absolute;inset:0;z-index:2;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0.75rem;background:var(--sfui-surface,#fff);color:var(--sfui-error,#c23934);padding:1.5rem;text-align:center}',
      '.sfui-retry-btn{background:none;border:none;color:var(--sfui-brand,#1b96ff);cursor:pointer;font:inherit;text-decoration:underline}',
      '.sfui-quick-actions{display:flex;flex-wrap:wrap;justify-content:center;gap:0.5rem;margin-top:1rem}',
      '.sfui-quick-action{background:none;border:1.5px solid var(--sfui-brand,#1b96ff);color:var(--sfui-brand,#1b96ff);border-radius:100px;padding:0.5rem 1.25rem;font:inherit;font-size:0.875rem;cursor:pointer;white-space:nowrap;transition:background 0.15s,color 0.15s}',
      '.sfui-quick-action:hover{background:var(--sfui-brand,#1b96ff);color:#fff}',
      '.sfui-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}'
    ].join('');
    document.head.appendChild(style);
  }

  function getBootstrapUrl(config) {
    if (config.bootstrapScriptUrl) return config.bootstrapScriptUrl;
    if (config.siteUrl) {
      return config.siteUrl.replace(/\/$/, '') + '/assets/js/bootstrap.min.js';
    }
    return '';
  }

  // --- InlineChat instance ---

  function InlineChat(container, config) {
    this._container = container;
    this._config = config;
    this._state = STATE.PROMPT;
    this._pendingQuery = '';
    this._bootstrapInited = false;
    this._readySeen = false;
    this._buttonCreatedSeen = false;
    this._sessionStatus = '';
    this._chatRevealed = false;
    this._timeoutId = null;
    this._iframePollId = null;
    this._revealTimeoutId = null;
    this._launchFallbackId = null;
    this._sendFallbackId = null;
    this._sendDelayId = null;
    this._initFallbackId = null;
    this._launchRetryId = null;
    this._sendRetryId = null;
    this._conversationOpen = false;
    this._boundListeners = {};
    this._els = {};
  }

  InlineChat.prototype.start = function () {
    this._config.siteUrl = (this._config.siteUrl || '').replace(/\/$/, '');
    this._mark('sfui-start');
    this._log('version', VERSION);
    injectStyles();
    this._render();

    // Eager bootstrap loading — start as soon as config is valid.
    var config = this._config;
    if (config.orgId && config.deploymentApiName && config.siteUrl) {
      this._state = STATE.INIT;
      this._els.promptPhase.classList.add('sfui-prompt-hidden');
      this._startInitFallback();
      this._loadBootstrapScript();
    }
  };

  // --- Rendering ---

  InlineChat.prototype._render = function () {
    var self = this;
    var wrapper = document.createElement('div');
    wrapper.className = 'sfui-wrapper';

    // -- Prompt phase --
    var promptPhase = document.createElement('div');
    promptPhase.className = 'sfui-prompt-phase';

    var card = document.createElement('div');
    card.className = 'sfui-search-card';

    var heading = document.createElement('h2');
    heading.className = 'sfui-heading';
    heading.textContent = this._config.heading || DEFAULT_HEADING;

    var row = document.createElement('div');
    row.className = 'sfui-input-row';

    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'sfui-input';
    input.placeholder = this._config.placeholder || DEFAULT_PLACEHOLDER;
    input.setAttribute('aria-label', 'Ask a question');

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sfui-submit-btn';
    btn.disabled = true;
    btn.setAttribute('aria-label', 'Submit');
    btn.appendChild(createArrowSvg());

    input.addEventListener('input', function () {
      btn.disabled = !input.value.trim();
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !input.disabled) {
        e.preventDefault();
        self._handleSubmit(input.value);
      }
    });
    btn.addEventListener('click', function () {
      self._handleSubmit(input.value);
    });

    row.appendChild(input);
    row.appendChild(btn);
    card.appendChild(heading);
    card.appendChild(row);

    // -- Quick action buttons --
    var actions = (this._config.quickActions || []).slice(0, 3);
    if (actions.length) {
      var actionsRow = document.createElement('div');
      actionsRow.className = 'sfui-quick-actions';
      for (var i = 0; i < actions.length; i++) {
        (function (text) {
          var actionBtn = document.createElement('button');
          actionBtn.type = 'button';
          actionBtn.className = 'sfui-quick-action';
          actionBtn.textContent = text;
          actionBtn.addEventListener('click', function () { self._handleSubmit(text); });
          actionsRow.appendChild(actionBtn);
        })(actions[i]);
      }
      card.appendChild(actionsRow);
    }

    promptPhase.appendChild(card);

    // -- Chat wrapper (hidden by default via CSS) --
    var chatWrapper = document.createElement('div');
    chatWrapper.className = 'sfui-chat-wrapper';

    var loading = document.createElement('div');
    loading.className = 'sfui-loading';
    loading.setAttribute('role', 'status');
    loading.setAttribute('aria-live', 'polite');

    var loadHeading = document.createElement('h2');
    loadHeading.className = 'sfui-loading-heading';
    loadHeading.textContent = this._config.heading || DEFAULT_HEADING;
    loading.appendChild(loadHeading);

    function createSkeleton(reverse) {
      var row = document.createElement('div');
      row.className = 'sfui-skel-row ' + (reverse ? 'sfui-skel-right' : 'sfui-skel-left');
      var wrap = document.createElement('div');
      wrap.className = 'sfui-skel-wrap' + (reverse ? ' sfui-skel-wrap-rev' : '');
      var avatar = document.createElement('div');
      avatar.className = 'sfui-skel-avatar';
      var lines = document.createElement('div');
      lines.className = 'sfui-skel-lines';
      for (var i = 0; i < 3; i++) {
        var bar = document.createElement('div');
        bar.className = 'sfui-skel-bar' + (i === 2 ? ' sfui-skel-bar-short' : '');
        lines.appendChild(bar);
      }
      wrap.appendChild(avatar);
      wrap.appendChild(lines);
      row.appendChild(wrap);
      return row;
    }

    loading.appendChild(createSkeleton(false));
    loading.appendChild(createSkeleton(true));

    var loadingText = document.createElement('span');
    loadingText.className = 'sfui-sr-only';
    loadingText.textContent = 'Loading...';
    loading.appendChild(loadingText);

    var error = document.createElement('div');
    error.className = 'sfui-error';
    error.style.display = 'none';
    error.setAttribute('role', 'alert');
    error.setAttribute('tabindex', '-1');

    var errorMsg = document.createElement('p');
    var retryBtn = document.createElement('button');
    retryBtn.type = 'button';
    retryBtn.className = 'sfui-retry-btn';
    retryBtn.textContent = 'Try again';
    retryBtn.addEventListener('click', function () { self._handleRetry(); });
    error.appendChild(errorMsg);
    error.appendChild(retryBtn);

    var chatContainer = document.createElement('div');
    chatContainer.className = 'sfui-chat-container';
    chatContainer.setAttribute('tabindex', '-1');

    chatWrapper.appendChild(loading);
    chatWrapper.appendChild(error);
    chatWrapper.appendChild(chatContainer);

    wrapper.appendChild(promptPhase);
    wrapper.appendChild(chatWrapper);

    this._container.textContent = '';
    this._container.appendChild(wrapper);

    this._els = {
      promptPhase: promptPhase,
      input: input,
      submitBtn: btn,
      chatWrapper: chatWrapper,
      loading: loading,
      error: error,
      errorMsg: errorMsg,
      chatContainer: chatContainer
    };
  };

  // --- User interaction ---

  InlineChat.prototype._handleSubmit = function (value) {
    if (this._state !== STATE.PROMPT && this._state !== STATE.PRIMED &&
        this._state !== STATE.READY && this._state !== STATE.INIT) return;
    var query = (value || '').trim();
    if (!query) return;
    if (query.length > MAX_QUERY_LENGTH) {
      this._showError('Message is too long. Please limit to ' + MAX_QUERY_LENGTH + ' characters.');
      return;
    }

    var config = this._config;
    if (!config.orgId || !config.deploymentApiName || !config.siteUrl) {
      this._showError('Configure orgId, deploymentApiName, and siteUrl. Get them from Setup > Embedded Service Deployments > your deployment > Code Snippet.');
      return;
    }

    if (this._els.input) this._els.input.disabled = true;
    if (this._els.submitBtn) this._els.submitBtn.disabled = true;

    this._mark('sfui-submit');

    var prevState = this._state;
    this._pendingQuery = query;
    this._chatRevealed = false;

    if (prevState === STATE.READY) {
      // Conversation already open — skip to SENDING
      this._setState(STATE.SENDING);
      this._startSendFallback();
      this._startTimeout();
    } else if (prevState === STATE.PRIMED) {
      // Bootstrap ready — skip LOADING, go directly to LAUNCHING
      this._setState(STATE.LOADING);
      this._startTimeout();
      this._tryLaunchChat(false);
    } else {
      // PROMPT or INIT — full flow
      this._setState(STATE.LOADING);
      this._startTimeout();
      if (this._bootstrapInited) {
        if (this._readySeen && this._buttonCreatedSeen) {
          this._tryLaunchChat(false);
        }
      } else {
        this._loadBootstrapScript();
      }
    }
  };

  // --- State management ---

  InlineChat.prototype._setState = function (newState) {
    var prevState = this._state;
    this._state = newState;
    this._log('state', prevState + ' -> ' + newState);

    // --- Layer visibility via CSS classes (crossfade) ---
    var isPromptLike = newState === STATE.PROMPT || newState === STATE.PRIMED || newState === STATE.READY || newState === STATE.INIT;
    var isChatActive = !isPromptLike;

    if (this._els.promptPhase) {
      if (isPromptLike) {
        this._els.promptPhase.classList.remove('sfui-prompt-hidden');
      } else {
        this._els.promptPhase.classList.add('sfui-prompt-hidden');
      }
    }

    if (this._els.chatWrapper) {
      if (isChatActive) {
        this._els.chatWrapper.classList.add('sfui-chat-visible');
      } else {
        this._els.chatWrapper.classList.remove('sfui-chat-visible');
      }
    }

    // --- Loading spinner: show when LOADING/LAUNCHING/SENDING or ACTIVE+not-revealed ---
    var showSpinner = (
      newState === STATE.LOADING ||
      newState === STATE.LAUNCHING ||
      newState === STATE.SENDING ||
      (newState === STATE.ACTIVE && !this._chatRevealed)
    );
    if (this._els.loading) {
      this._els.loading.style.display = showSpinner ? '' : 'none';
    }

    if (newState === STATE.ACTIVE || newState === STATE.ERROR) {
      this._clearTimers();
    }
    if (newState === STATE.ACTIVE) {
      this._revealChat();
    }
  };

  // --- Bootstrap loading ---

  InlineChat.prototype._loadBootstrapScript = function () {
    var self = this;

    if (scriptLoaded) {
      if (typeof window.embeddedservice_bootstrap !== 'undefined') {
        this._initChat();
      }
      return;
    }

    var url = getBootstrapUrl(this._config);
    if (!url) {
      this._showError('Could not determine bootstrap script URL. Provide a valid siteUrl.');
      return;
    }
    if (!isTrustedSalesforceUrl(url)) {
      this._showError('Bootstrap script URL is not from a trusted Salesforce domain.');
      return;
    }

    // Set eagerly to prevent double-loading if _loadBootstrapScript is called
    // again while the script is still downloading. onerror resets it on failure.
    // There is no teardown hook — the IIFE scope lives
    // for the page lifetime, so the flag cannot become stale from component teardown.
    scriptLoaded = true;
    var script = document.createElement('script');
    script.src = url;
    script.onload = function () { self._mark('sfui-script-loaded'); self._initChat(); };
    script.onerror = function () {
      scriptLoaded = false;
      self._showError('Failed to load chat script. Verify Site URL.');
    };
    document.body.appendChild(script);
  };

  // --- Chat initialization ---

  InlineChat.prototype._initChat = function () {
    if (this._bootstrapInited) return;

    var chatElement = this._els.chatContainer;
    if (!chatElement) {
      this._showError('Chat container not found.');
      return;
    }

    if (typeof window.embeddedservice_bootstrap === 'undefined') {
      this._showError('Embedded Messaging bootstrap not available. Check deployment and Site URL.');
      return;
    }

    var bootstrap = window.embeddedservice_bootstrap;
    bootstrap.settings.language = 'en_US';
    bootstrap.settings.displayMode = 'inline';
    bootstrap.settings.disableInlineAutoLaunch = true;
    bootstrap.settings.targetElement = chatElement;

    if (!isTrustedSalesforceUrl(this._config.siteUrl)) {
      this._showError('Site URL is not from a trusted Salesforce domain.');
      return;
    }

    if (this._config.scrt2Url && !isTrustedSalesforceUrl(this._config.scrt2Url)) {
      this._showError('SCRT2 URL is not from a trusted Salesforce domain.');
      return;
    }

    // Attach listeners synchronously before init() so no events are missed.
    this._attachListeners();

    this._bootstrapInited = true;
    var initOptions = this._config.scrt2Url ? { scrt2URL: this._config.scrt2Url } : {};
    bootstrap.init(this._config.orgId, this._config.deploymentApiName, this._config.siteUrl, initOptions);
    this._mark('sfui-bootstrap-init');
  };

  // --- Event listeners ---

  InlineChat.prototype._attachListeners = function () {
    var self = this;
    var events = {
      onEmbeddedMessagingReady: function () { self._onReady(); },
      onEmbeddedMessagingButtonCreated: function () { self._onButtonCreated(); },
      onEmbeddedMessagingInitError: function (e) { self._onInitError(e); },
      onEmbeddedMessagingConversationOpened: function () { self._onConversationOpened(); },
      onEmbeddedMessagingFirstBotMessageSent: function () { self._onFirstBotMessage(); },
      onEmbeddedMessagingSessionStatusUpdate: function (e) { self._onSessionStatus(e); },
      onEmbeddedMessagingConversationClosed: function () { self._onConversationClosed(); },
      onEmbeddedMessagingWindowClosed: function () { self._onConversationClosed(); }
    };

    var key;
    for (key in events) {
      if (events.hasOwnProperty(key)) {
        this._boundListeners[key] = events[key];
        window.addEventListener(key, events[key]);
      }
    }
  };

  InlineChat.prototype._removeListeners = function () {
    var key;
    for (key in this._boundListeners) {
      if (this._boundListeners.hasOwnProperty(key)) {
        window.removeEventListener(key, this._boundListeners[key]);
      }
    }
    this._boundListeners = {};
  };

  // --- Bootstrap cleanup ---

  InlineChat.prototype._nukeBootstrap = function () {
    this._clearTimers();
    this._removeListeners();

    // Clear chat container
    var chatEl = this._els.chatContainer;
    if (chatEl) {
      chatEl.textContent = '';
    }

    // Remove bootstrap DOM injected outside our container
    // (FAB button, overlays, modals, iframes, styles, etc.)
    // Note: the broad selector could affect other InlineChat instances on the
    // same page. We guard against this by also skipping elements inside any
    // .sfui-wrapper (each instance's root element).
    var hits = document.querySelectorAll(
      '[class*="embeddedMessaging"], [class*="embedded-messaging"], [id*="embeddedMessaging"]'
    );
    var self = this;
    for (var i = 0; i < hits.length; i++) {
      if (!self._container.contains(hits[i]) && !hits[i].closest('.sfui-wrapper')) {
        hits[i].parentNode.removeChild(hits[i]);
      }
    }

    // Reset flags but keep script loaded — bootstrap can't be re-downloaded,
    // we re-call init() on the existing global with a fresh target element.
    this._bootstrapInited = false;
    this._readySeen = false;
    this._buttonCreatedSeen = false;
    this._sessionStatus = '';
    this._pendingQuery = '';
    this._chatRevealed = false;
    this._conversationOpen = false;
  };

  // --- Event handlers ---

  InlineChat.prototype._onReady = function () {
    this._log('event', 'Ready');
    this._mark('sfui-ready');
    this._readySeen = true;
    this._tryAdvance();
  };

  InlineChat.prototype._onButtonCreated = function () {
    this._log('event', 'ButtonCreated');
    this._buttonCreatedSeen = true;
    this._hideFab();
    this._tryAdvance();
  };

  InlineChat.prototype._onInitError = function (event) {
    var detail = (event && event.detail) ? event.detail : {};
    this._log('event', 'InitError: ' + JSON.stringify(detail));
    this._showError('Chat failed to initialize. Check the deployment configuration (orgId, deploymentApiName, siteUrl) and ensure the deployment is published.');
  };

  InlineChat.prototype._tryAdvance = function () {
    if (!this._readySeen || !this._buttonCreatedSeen) return;

    // Existing session detected — resume if pending query, else mark PRIMED.
    if (this._sessionStatus === 'Active' &&
        (this._state === STATE.INIT || this._state === STATE.PROMPT)) {
      this._clearInitFallback();
      if (this._pendingQuery) {
        this._log('lifecycle', 'Existing session detected with pending query, resuming');
        this._setState(STATE.ACTIVE);
        return;
      }
      this._log('lifecycle', 'Existing session detected, auto-resuming');
      this._setState(STATE.ACTIVE);
      return;
    }

    // Bootstrap ready during INIT → PRIMED.
    if (this._state === STATE.INIT) {
      this._clearInitFallback();
      this._mark('sfui-primed');
      this._setState(STATE.PRIMED);
      return;
    }

    // Bootstrap ready during PROMPT → PRIMED.
    if (this._state === STATE.PROMPT) {
      this._mark('sfui-primed');
      this._setState(STATE.PRIMED);
      return;
    }

    if (this._state === STATE.LOADING) {
      this._tryLaunchChat(false);
    }
  };

  InlineChat.prototype._onConversationOpened = function () {
    this._log('event', 'ConversationOpened');
    this._mark('sfui-conv-opened');
    this._conversationOpen = true;
    this._clearLaunchFallback();

    if (this._state === STATE.ACTIVE) return;

    // ConversationOpened without pending query in prompt-like state = stale session → READY.
    if ((this._state === STATE.PROMPT || this._state === STATE.PRIMED) && !this._pendingQuery) {
      this._log('lifecycle', 'ConversationOpened without user intent, auto-resuming');
      this._setState(STATE.ACTIVE);
      return;
    }

    if (this._pendingQuery) {
      this._setState(STATE.SENDING);
      this._startSendFallback();
    } else {
      this._setState(STATE.ACTIVE);
    }
  };

  InlineChat.prototype._onFirstBotMessage = function () {
    this._log('event', 'FirstBotMessageSent');
    this._mark('sfui-first-bot-msg');
    this._clearSendFallback();
    if (this._pendingQuery && this._state === STATE.SENDING) {
      var self = this;
      this._sendDelayId = setTimeout(function () {
        if (self._config && self._pendingQuery && self._state === STATE.SENDING) {
          self._trySendMessage(self._pendingQuery, false);
        }
      }, SEND_DELAY_MS);
    }
  };

  InlineChat.prototype._onSessionStatus = function (event) {
    var detail = event && event.detail ? event.detail : {};
    var status = detail.status || detail.sessionStatus || '';
    this._sessionStatus = status;
    this._log('event', 'SessionStatus: ' + status);

    if (status === 'Active' && (this._state === STATE.INIT || this._state === STATE.PROMPT || this._state === STATE.PRIMED)) {
      if (this._readySeen && this._buttonCreatedSeen) {
        this._clearInitFallback();
        if (this._pendingQuery) {
          this._log('lifecycle', 'SessionStatus Active with pending query — resuming');
          this._setState(STATE.ACTIVE);
        } else {
          this._log('lifecycle', 'SessionStatus Active, auto-resuming');
          this._setState(STATE.ACTIVE);
        }
      }
    }
  };

  InlineChat.prototype._resetInputUI = function () {
    if (this._els.error) this._els.error.style.display = 'none';
    if (this._els.input) {
      this._els.input.value = '';
      this._els.input.disabled = false;
      this._els.input.focus();
    }
    if (this._els.submitBtn) this._els.submitBtn.disabled = true;
  };

  InlineChat.prototype._onConversationClosed = function () {
    if (this._state === STATE.PROMPT || this._state === STATE.PRIMED) return; // already cleaned up
    this._log('event', 'ConversationClosed');
    this._nukeBootstrap();
    this._setState(STATE.PROMPT);
    this._resetInputUI();

    // Reinitialize bootstrap in background for next conversation
    this._loadBootstrapScript();
  };

  // --- API calls with single retry ---

  InlineChat.prototype._tryLaunchChat = function (isRetry) {
    if (!this._config) return;
    var self = this;
    this._startTimeout();
    this._setState(STATE.LAUNCHING);
    var bootstrap = window.embeddedservice_bootstrap;

    function retry() {
      if (!isRetry) {
        self._log('api', 'launchChat retry');
        self._launchRetryId = setTimeout(function () { self._tryLaunchChat(true); }, RETRY_DELAY_MS);
      } else {
        self._showError('Failed to open chat. Please try again.');
      }
    }

    if (!bootstrap || !bootstrap.utilAPI || !bootstrap.utilAPI.launchChat) {
      this._log('warn', 'launchChat not available' + (isRetry ? ' (retry)' : ''));
      retry();
      return;
    }

    try {
      this._mark('sfui-launch');
      var result = bootstrap.utilAPI.launchChat();
      if (result && typeof result.then === 'function') {
        result
          .then(function () {
            self._log('api', 'launchChat resolved');
            if (self._conversationOpen && self._pendingQuery) {
              self._log('lifecycle', 'Conversation already open, skipping to SENDING');
              self._setState(STATE.SENDING);
              self._startSendFallback();
              return;
            }
            self._startLaunchFallback();
          })
          .catch(function (err) {
            self._log('api', 'launchChat rejected: ' + err);
            retry();
          });
      } else {
        self._log('api', 'launchChat returned (no promise)');
        if (self._conversationOpen && self._pendingQuery) {
          self._log('lifecycle', 'Conversation already open, skipping to SENDING');
          self._setState(STATE.SENDING);
          self._startSendFallback();
        } else {
          self._startLaunchFallback();
        }
      }
    } catch (err) {
      self._log('api', 'launchChat threw: ' + err);
      retry();
    }
  };

  InlineChat.prototype._trySendMessage = function (text, isRetry) {
    if (!this._config) return;
    this._pendingQuery = '';
    var self = this;
    var bootstrap = window.embeddedservice_bootstrap;

    function retry() {
      if (!isRetry) {
        self._log('api', 'sendTextMessage retry');
        self._sendRetryId = setTimeout(function () { self._trySendMessage(text, true); }, RETRY_DELAY_MS);
      } else {
        self._log('warn', 'sendTextMessage failed after retry, proceeding to ACTIVE');
        self._setState(STATE.ACTIVE);
      }
    }

    if (!bootstrap || !bootstrap.utilAPI || !bootstrap.utilAPI.sendTextMessage) {
      this._log('warn', 'sendTextMessage not available' + (isRetry ? ' (retry)' : ''));
      retry();
      return;
    }

    try {
      var result = bootstrap.utilAPI.sendTextMessage(text);
      if (result && typeof result.then === 'function') {
        result
          .then(function () {
            self._log('api', 'sendTextMessage resolved');
            self._mark('sfui-msg-sent');
            self._setState(STATE.ACTIVE);
          })
          .catch(function (err) {
            self._log('api', 'sendTextMessage rejected: ' + err);
            retry();
          });
      } else {
        // Synchronous success (no promise returned)
        self._log('api', 'sendTextMessage returned (no promise)');
        self._setState(STATE.ACTIVE);
      }
    } catch (err) {
      self._log('api', 'sendTextMessage threw: ' + err);
      retry();
    }
  };

  // --- FAB hiding ---

  InlineChat.prototype._hideFab = function () {
    var self = this;
    try {
      var bootstrap = window.embeddedservice_bootstrap;
      if (bootstrap && bootstrap.utilAPI && bootstrap.utilAPI.hideChatButton) {
        var result = bootstrap.utilAPI.hideChatButton();
        if (result && typeof result.catch === 'function') {
          result.catch(function (err) { self._log('warn', 'hideFab failed: ' + err); });
        }
      }
    } catch (e) { self._log('warn', 'hideFab error: ' + e); }
  };

  // --- Spinner / reveal ---

  InlineChat.prototype._revealChat = function () {
    if (this._iframePollId || this._chatRevealed) return;

    var self = this;
    var chatElement = this._els.chatContainer;
    var loadingEl = this._els.loading;

    if (!chatElement) {
      this._chatRevealed = true;
      return;
    }

    function doReveal() {
      self._chatRevealed = true;
      self._clearIframePoll();
      if (loadingEl) loadingEl.style.display = 'none';
      if (chatElement) chatElement.focus();
      self._log('lifecycle', 'Chat iframe revealed');
      self._mark('sfui-active');
      if (typeof performance !== 'undefined' && performance.measure) {
        function safeMeasure(name, start, end) {
          try { return Math.round(performance.measure(name, start, end).duration); }
          catch (e) { return null; }
        }
        var perf = {};
        var d;
        d = safeMeasure('sfui-time-to-primed', 'sfui-start', 'sfui-primed');
        if (d !== null) perf.timeToPrimed = d;
        d = safeMeasure('sfui-launch-duration', 'sfui-launch', 'sfui-conv-opened');
        if (d !== null) perf.launchDuration = d;
        d = safeMeasure('sfui-welcome-duration', 'sfui-conv-opened', 'sfui-first-bot-msg');
        if (d !== null) perf.welcomeDuration = d;
        d = safeMeasure('sfui-time-to-active', 'sfui-submit', 'sfui-active');
        if (d !== null) perf.timeToActive = d;
        self._log('perf', JSON.stringify(perf));
        try {
          var history = JSON.parse(localStorage.getItem('sfui_perf') || '[]');
          perf.timestamp = Date.now();
          history.push(perf);
          if (history.length > 50) history = history.slice(-50);
          localStorage.setItem('sfui_perf', JSON.stringify(history));
        } catch (e) { /* localStorage unavailable */ }
        var marks = ['sfui-start','sfui-script-loaded','sfui-bootstrap-init','sfui-ready',
          'sfui-primed','sfui-submit','sfui-launch','sfui-conv-opened',
          'sfui-first-bot-msg','sfui-msg-sent','sfui-active'];
        for (var mi = 0; mi < marks.length; mi++) {
          try { performance.clearMarks(marks[mi]); } catch (e) {}
        }
      }
    }

    function tryReveal() {
      var iframe = chatElement.querySelector('iframe');
      if (iframe && iframe.offsetWidth >= 250 && iframe.offsetHeight >= 300) {
        doReveal();
      }
    }

    this._iframePollId = setInterval(tryReveal, IFRAME_POLL_MS);

    this._revealTimeoutId = setTimeout(function () {
      if (!self._chatRevealed) doReveal();
    }, IFRAME_MAX_WAIT_MS);
  };

  // --- Error ---

  InlineChat.prototype._showError = function (message) {
    this._log('error', message);
    this._setState(STATE.ERROR);
    if (this._els.loading) this._els.loading.style.display = 'none';
    if (this._els.errorMsg) this._els.errorMsg.textContent = message;
    if (this._els.error) {
      this._els.error.style.display = 'flex';
      this._els.error.focus();
    }
  };

  InlineChat.prototype._handleRetry = function () {
    this._log('lifecycle', 'User clicked retry');
    this._nukeBootstrap();
    this._pendingQuery = '';
    this._chatRevealed = false;
    this._setState(STATE.PROMPT);

    this._resetInputUI();
    this._loadBootstrapScript();
  };

  // --- Public destroy ---

  InlineChat.prototype.destroy = function () {
    this._log('lifecycle', 'Destroying instance');
    this._nukeBootstrap();
    if (this._container) {
      var wrapper = this._container.querySelector('.sfui-wrapper');
      if (wrapper) this._container.removeChild(wrapper);
    }
    this._els = {};
    this._container = null;
    this._config = null;
  };

  // --- Timeout ---

  InlineChat.prototype._startTimeout = function () {
    var self = this;
    this._clearTimeout();
    this._timeoutId = setTimeout(function () {
      if (!self._config) return;
      if (self._state === STATE.ACTIVE || self._state === STATE.ERROR || self._state === STATE.PROMPT || self._state === STATE.PRIMED || self._state === STATE.READY || self._state === STATE.INIT) {
        return;
      }
      self._showError('Chat did not load in time. Please try again.');
    }, DEFAULT_TIMEOUT_MS);
  };

  // --- Fallback timers ---

  InlineChat.prototype._startLaunchFallback = function () {
    var self = this;
    this._clearLaunchFallback();
    this._launchFallbackId = setTimeout(function () {
      if (!self._config) return;
      if (self._state === STATE.LAUNCHING) {
        if (self._pendingQuery) {
          self._log('fallback', 'ConversationOpened not received, attempting to send message');
          self._setState(STATE.SENDING);
          self._startSendFallback();
        } else {
          self._log('fallback', 'ConversationOpened not received, advancing to ACTIVE');
          self._setState(STATE.ACTIVE);
        }
      }
    }, LAUNCH_FALLBACK_MS);
  };

  InlineChat.prototype._clearLaunchFallback = function () {
    if (this._launchFallbackId) {
      clearTimeout(this._launchFallbackId);
      this._launchFallbackId = null;
    }
  };

  InlineChat.prototype._clearSendDelay = function () {
    if (this._sendDelayId) {
      clearTimeout(this._sendDelayId);
      this._sendDelayId = null;
    }
  };

  InlineChat.prototype._startSendFallback = function () {
    var self = this;
    this._clearSendFallback();
    this._sendFallbackId = setTimeout(function () {
      if (!self._config) return;
      if (self._state === STATE.SENDING && self._pendingQuery) {
        self._log('fallback', 'FirstBotMessage not received, sending message anyway');
        self._trySendMessage(self._pendingQuery, false);
      }
    }, SEND_FALLBACK_MS);
  };

  InlineChat.prototype._clearSendFallback = function () {
    if (this._sendFallbackId) {
      clearTimeout(this._sendFallbackId);
      this._sendFallbackId = null;
    }
  };

  InlineChat.prototype._startInitFallback = function () {
    var self = this;
    this._clearInitFallback();
    this._initFallbackId = setTimeout(function () {
      if (!self._config) return;
      if (self._state === STATE.INIT) {
        self._log('fallback', 'Bootstrap did not resolve in time, falling back to PROMPT');
        self._setState(STATE.PROMPT);
      }
    }, INIT_FALLBACK_MS);
  };

  InlineChat.prototype._clearInitFallback = function () {
    if (this._initFallbackId) {
      clearTimeout(this._initFallbackId);
      this._initFallbackId = null;
    }
  };

  // --- Cleanup ---

  InlineChat.prototype._clearTimers = function () {
    this._clearTimeout();
    this._clearIframePoll();
    this._clearLaunchFallback();
    this._clearSendDelay();
    this._clearSendFallback();
    this._clearInitFallback();
    if (this._launchRetryId) {
      clearTimeout(this._launchRetryId);
      this._launchRetryId = null;
    }
    if (this._sendRetryId) {
      clearTimeout(this._sendRetryId);
      this._sendRetryId = null;
    }
  };

  InlineChat.prototype._clearTimeout = function () {
    if (this._timeoutId) {
      clearTimeout(this._timeoutId);
      this._timeoutId = null;
    }
  };

  InlineChat.prototype._clearIframePoll = function () {
    if (this._iframePollId) {
      clearInterval(this._iframePollId);
      this._iframePollId = null;
    }
    if (this._revealTimeoutId) {
      clearTimeout(this._revealTimeoutId);
      this._revealTimeoutId = null;
    }
  };

  // --- Debug & Performance ---

  InlineChat.prototype._log = function (label, detail) {
    if (this._config && this._config.debug) {
      console.log('[HAA]', label, detail || ''); // eslint-disable-line no-console
    }
  };

  InlineChat.prototype._mark = function (name) {
    if (typeof performance !== 'undefined' && performance.mark) {
      performance.mark(name);
    }
  };

  // --- Public API ---

  function init(config) {
    var containerId = config.containerId || config.container;
    var container = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
    if (!container) {
      console.error('[HAA] Container not found:', containerId); // eslint-disable-line no-console
      return;
    }
    var instance = new InlineChat(container, config);
    instance.start();
    return instance;
  }

  function autoInit() {
    var script = document.querySelector('script[data-target][src*="enhanced-chat-inline"]');
    if (!script) return;
    var targetId = script.getAttribute('data-target');
    var el = document.getElementById(targetId);
    if (!el) return;

    window.EnhancedChatInline.instance = init({
      containerId: targetId,
      orgId: el.getAttribute('data-org-id') || '',
      deploymentApiName: el.getAttribute('data-deployment') || el.getAttribute('data-deployment-api-name') || '',
      siteUrl: (el.getAttribute('data-site-url') || '').replace(/\/$/, ''),
      scrt2Url: el.getAttribute('data-scrt2-url') || '',
      bootstrapScriptUrl: el.getAttribute('data-bootstrap-url') || '',
      heading: el.getAttribute('data-heading') || '',
      placeholder: el.getAttribute('data-placeholder') || '',
      quickActions: [
        el.getAttribute('data-starter-prompt-1'),
        el.getAttribute('data-starter-prompt-2'),
        el.getAttribute('data-starter-prompt-3')
      ].filter(Boolean),
      debug: el.hasAttribute('data-debug')
    });
  }

  window.EnhancedChatInline = { init: init, version: VERSION };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInit);
  } else {
    autoInit();
  }
})();
