(function () {
  'use strict';

  // ─── Config from script tag ──────────────────────────────────────
  var scriptTag = document.querySelector('script[data-vobase-widget]');
  if (!scriptTag) return;

  var channelInstanceId = scriptTag.getAttribute('data-channel-instance-id') || '';
  var botName = scriptTag.getAttribute('data-bot-name') || 'Support';
  var color = scriptTag.getAttribute('data-color') || '#6b5b4e';
  var welcomeHeading = scriptTag.getAttribute('data-welcome-heading') || 'Hi there!';
  var welcomeTagline = scriptTag.getAttribute('data-welcome-tagline') || 'How can we help?';

  // Derive API base from script src
  var apiUrl = scriptTag.getAttribute('data-api-url');
  if (!apiUrl) {
    try {
      var src = scriptTag.getAttribute('src');
      apiUrl = src ? new URL(src, window.location.href).origin : window.location.origin;
    } catch (e) {
      apiUrl = window.location.origin;
    }
  }

  var avatarUrl = scriptTag.getAttribute('data-avatar-url') || '';
  var chatUrl = apiUrl + '/chat/' + encodeURIComponent(channelInstanceId) + '?embed=true';

  // ─── Helpers ─────────────────────────────────────────────────────
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'style' && typeof attrs[k] === 'object') {
          Object.keys(attrs[k]).forEach(function (s) { node.style[s] = attrs[k][s]; });
        } else if (k === 'className') {
          node.className = attrs[k];
        } else if (k === 'textContent') {
          node.textContent = attrs[k];
        } else {
          node.setAttribute(k, attrs[k]);
        }
      });
    }
    if (children) {
      children.forEach(function (child) {
        if (typeof child === 'string') {
          node.appendChild(document.createTextNode(child));
        } else if (child) {
          node.appendChild(child);
        }
      });
    }
    return node;
  }

  function svgEl(paths) {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    paths.forEach(function (d) {
      var p = document.createElementNS(ns, 'path');
      p.setAttribute('d', d);
      svg.appendChild(p);
    });
    return svg;
  }

  function dot() {
    return el('span', { className: 'vw-dot' });
  }

  function avatarImg(size) {
    if (avatarUrl) {
      return el('img', { src: avatarUrl, alt: botName, style: { width: size, height: size, borderRadius: '50%', objectFit: 'cover' } });
    }
    var wrap = el('div', { style: { width: size, height: size, borderRadius: '50%', background: color, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' } });
    var icon = svgEl(['M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z']);
    icon.style.width = '55%';
    icon.style.height = '55%';
    wrap.appendChild(icon);
    return wrap;
  }

  // ─── Styles ──────────────────────────────────────────────────────
  var BUBBLE_SIZE = 60;
  var PANEL_W = 400;
  var PANEL_H = 560;

  var style = document.createElement('style');
  style.textContent = [
    '#vw-container,#vw-container *,#vw-container *::before,#vw-container *::after{box-sizing:border-box;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}',
    '#vw-container{all:initial;position:fixed;bottom:20px;right:20px;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:14px;line-height:1.5;color:#1a1a1a;opacity:1;visibility:visible;pointer-events:auto}',
    '#vw-bubble{width:' + BUBBLE_SIZE + 'px;height:' + BUBBLE_SIZE + 'px;border-radius:50%;border:none;cursor:pointer;padding:0;overflow:hidden;background:' + color + ';box-shadow:0 4px 16px rgba(0,0,0,.15),0 2px 4px rgba(0,0,0,.1);transition:transform .2s ease,box-shadow .2s ease;display:flex;align-items:center;justify-content:center}',
    '#vw-bubble:hover{transform:scale(1.05);box-shadow:0 6px 20px rgba(0,0,0,.2),0 3px 6px rgba(0,0,0,.12)}',
    '#vw-bubble:active{transform:scale(.97)}',
    '#vw-bubble img{width:100%;height:100%;object-fit:cover;border-radius:50%}',
    '#vw-bubble svg{width:24px;height:24px;color:#fff}',
    '#vw-panel{position:absolute;bottom:' + (BUBBLE_SIZE + 12) + 'px;right:0;width:' + PANEL_W + 'px;height:' + PANEL_H + 'px;border-radius:16px;overflow:hidden;box-shadow:0 12px 48px rgba(0,0,0,.15),0 4px 16px rgba(0,0,0,.08);background:#fff;display:none;flex-direction:column;animation:vw-up .25s ease-out}',
    '#vw-panel.vw-open{display:flex}',
    '#vw-welcome{display:flex;flex-direction:column;height:100%}',
    '#vw-wh{background:#fff;padding:20px;display:flex;align-items:center;gap:12px;border-bottom:1px solid #e5e5e5}',
    '#vw-wh-info{display:flex;flex-direction:column;gap:2px}',
    '#vw-wh-name{font-size:16px;font-weight:600;display:flex;align-items:center;gap:6px}',
    '#vw-wh-sub{font-size:12px;color:#6b7280}',
    '.vw-dot{width:8px;height:8px;border-radius:50%;background:#22c55e;display:inline-block;flex-shrink:0}',
    '#vw-wb{flex:1;display:flex;flex-direction:column;justify-content:flex-end;padding:20px;background:linear-gradient(180deg,#f8f7f6,#fff)}',
    '#vw-wcard{background:#fff;border-radius:12px;padding:20px;box-shadow:0 1px 4px rgba(0,0,0,.06);border:1px solid #e5e5e5}',
    '#vw-wcard h3{font-size:18px;font-weight:600;margin:0 0 4px}',
    '#vw-wcard-tagline{font-size:14px;color:#6b7280;margin:0 0 16px}',
    '#vw-wstatus{display:flex;align-items:center;gap:6px;font-size:12px;color:#6b7280;margin-bottom:16px}',
    '#vw-start{background:none;border:none;font-size:14px;font-weight:600;cursor:pointer;padding:0;display:inline-flex;align-items:center;gap:6px;color:#1a1a1a;font-family:inherit;transition:color .15s}',
    '#vw-start:hover{color:' + color + '}',
    '#vw-start svg{width:16px;height:16px;transition:transform .15s}',
    '#vw-start:hover svg{transform:translateX(3px)}',
    '#vw-powered{text-align:center;padding:10px;font-size:11px;color:#9ca3af}',
    '#vw-iframe{width:100%;height:100%;border:none;display:none}',
    '#vw-iframe.vw-active{display:block}',
    '@keyframes vw-up{from{opacity:0;transform:translateY(12px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}',
    '@media(max-width:480px){#vw-panel{width:calc(100vw - 24px);height:calc(100vh - 100px);max-height:600px;right:-8px}}'
  ].join('\n');
  document.head.appendChild(style);

  // ─── Build DOM ───────────────────────────────────────────────────

  var whInfo = el('div', { id: 'vw-wh-info' }, [
    el('div', { id: 'vw-wh-name' }, [botName, dot()]),
    el('div', { id: 'vw-wh-sub', textContent: 'Typically replies in a few minutes' }),
  ]);
  var wHeader = el('div', { id: 'vw-wh' }, [avatarImg('44px'), whInfo]);

  var heading = el('h3', { textContent: welcomeHeading });
  var tagline = el('p', { id: 'vw-wcard-tagline', textContent: welcomeTagline });
  var status = el('div', { id: 'vw-wstatus' }, [dot(), 'We are Online']);
  var arrowSvg = svgEl(['M5 12L19 12', 'M12 5L19 12L12 19']);
  var startBtn = el('button', { id: 'vw-start', type: 'button' }, ['Start Conversation ', arrowSvg]);
  var card = el('div', { id: 'vw-wcard' }, [heading, tagline, status, startBtn]);
  var wBody = el('div', { id: 'vw-wb' }, [card]);

  var powered = el('div', { id: 'vw-powered', textContent: '⚡ Powered by Vobase' });
  var welcome = el('div', { id: 'vw-welcome' }, [wHeader, wBody, powered]);

  var iframe = el('iframe', { id: 'vw-iframe', title: botName + ' Chat', allow: 'microphone' });

  var panel = el('div', { id: 'vw-panel' }, [welcome, iframe]);

  var bubble = el('button', { id: 'vw-bubble', 'aria-label': 'Open chat', type: 'button' }, [avatarImg('100%')]);

  var container = el('div', { id: 'vw-container' }, [panel, bubble]);
  document.body.appendChild(container);

  // ─── State & interactions ────────────────────────────────────────
  var isOpen = false;
  var chatStarted = false;

  function setCloseIcon() {
    while (bubble.firstChild) bubble.removeChild(bubble.firstChild);
    var svg = svgEl(['M18 6L6 18', 'M6 6L18 18']);
    bubble.appendChild(svg);
    bubble.setAttribute('aria-label', 'Close chat');
  }

  function setAvatarIcon() {
    while (bubble.firstChild) bubble.removeChild(bubble.firstChild);
    bubble.appendChild(avatarImg('100%'));
    bubble.setAttribute('aria-label', 'Open chat');
  }

  function toggle() {
    isOpen = !isOpen;
    if (isOpen) {
      panel.classList.add('vw-open');
      setCloseIcon();
    } else {
      panel.classList.remove('vw-open');
      setAvatarIcon();
    }
  }

  function startChat() {
    if (chatStarted) return;
    chatStarted = true;

    while (startBtn.firstChild) startBtn.removeChild(startBtn.firstChild);
    startBtn.appendChild(document.createTextNode('Connecting...'));
    startBtn.disabled = true;

    // Create anonymous session from parent page (avoids third-party cookie issues).
    fetch(apiUrl + '/api/auth/sign-in/anonymous', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: '{}'
    })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      // better-auth anonymous plugin returns `{ token, user }`.
      var sessionToken = data && (data.token || (data.session && data.session.token)) || '';
      iframe.src = chatUrl + (sessionToken ? '&token=' + encodeURIComponent(sessionToken) : '');
      iframe.classList.add('vw-active');
      welcome.style.display = 'none';
    })
    .catch(function () {
      iframe.src = chatUrl;
      iframe.classList.add('vw-active');
      welcome.style.display = 'none';
    });
  }

  bubble.addEventListener('click', toggle);
  startBtn.addEventListener('click', startChat);
})();
