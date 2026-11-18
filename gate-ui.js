(() => {
  'use strict';

  const words = {
    en: {
      brand: 'Academic homepage', studio: 'Hao Jing’s personal homepage', heading: 'Welcome',
      intro: 'Use the invitation code from my email to visit my academic homepage.',
      placeholder: 'Paste your invitation code',
      label: 'Invitation code', enter: 'Enter homepage', opening: 'Opening…', open: 'Welcome',
      languages: 'Language', reveal: 'Show invitation code', conceal: 'Hide invitation code',
      empty: 'Enter your invitation code.', wrong: 'This invitation code is invalid or no longer active.',
      limited: 'Too many attempts. Please try again later.', updated: 'The homepage has been updated. Refresh the page and try again.',
      unavailable: 'The homepage could not be opened. Please refresh and try again.',
      network: 'The page couldn’t be loaded. Please try again.',
      unsupported: 'Open the secure link in an up-to-date browser.'
    },
    zh: {
      brand: '学术主页', studio: '荆昊的个人主页', heading: '欢迎来访',
      intro: '请输入邀请邮件中的邀请码，访问我的学术主页。',
      placeholder: '粘贴邀请码',
      label: '邀请码', enter: '进入主页', opening: '正在打开…', open: '欢迎来访',
      languages: '选择语言', reveal: '显示邀请码', conceal: '隐藏邀请码',
      empty: '请输入邀请码。', wrong: '邀请码无效或已停用，请核对后重试。',
      limited: '尝试次数过多，请稍后再试。', updated: '主页已更新，请刷新页面后重试。',
      unavailable: '主页暂时无法打开，请刷新后重试。',
      network: '页面未能加载，请重试。', unsupported: '请使用新版浏览器打开安全链接。'
    },
    it: {
      brand: 'Pagina accademica', studio: 'Pagina personale di Hao Jing', heading: 'Benvenuti',
      intro: 'Usa il codice ricevuto nella mia email di invito per visitare la mia pagina accademica.',
      placeholder: 'Incolla il codice di invito',
      label: 'Codice di invito', enter: 'Accedi alla pagina', opening: 'Apertura…', open: 'Benvenuti',
      languages: 'Lingua', reveal: 'Mostra il codice', conceal: 'Nascondi il codice',
      empty: 'Inserisci il codice di invito.', wrong: 'Il codice di invito non è valido o non è più attivo.',
      limited: 'Troppi tentativi. Riprova più tardi.', updated: 'La pagina è stata aggiornata. Ricaricala e riprova.',
      unavailable: 'Impossibile aprire la pagina. Ricaricala e riprova.',
      network: 'Impossibile caricare la pagina. Riprova.',
      unsupported: 'Apri il link sicuro in un browser aggiornato.'
    }
  };
  const form = document.getElementById('gate-form');
  const input = document.getElementById('gate-password');
  const reveal = document.getElementById('gate-reveal');
  const submit = document.getElementById('gate-submit');
  const submitLabel = document.getElementById('gate-submit-label');
  const message = document.getElementById('gate-message');
  const langs = document.querySelectorAll('[data-gate-lang]');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let language;
  let busy = false;
  let opened = false;
  let errorType = '';

  function supported(value) {
    return Object.hasOwn(words, value);
  }
  function initialLanguage() {
    const requested = new URLSearchParams(location.search).get('lang');
    if (supported(requested)) return requested;
    try {
      const saved = localStorage.getItem('lang');
      if (supported(saved)) return saved;
    } catch { /* The language switcher also works without storage. */ }
    const preferences = navigator.languages?.length ? navigator.languages : [navigator.language || 'en'];
    return preferences.map(item => item.toLowerCase().split('-')[0]).find(supported) || 'en';
  }
  function updatePose() {
    let pose = 'idle';
    if (opened) pose = 'welcome';
    else if (input.type === 'text') pose = 'shy';
    else if (errorType) pose = 'error';
    else if (document.activeElement === input || busy) pose = 'typing';
    document.body.dataset.pose = pose;
  }
  function updateControls() {
    const copy = words[language];
    submitLabel.textContent = copy[opened ? 'open' : busy ? 'opening' : 'enter'];
    message.textContent = errorType ? copy[errorType] : '';
    const revealed = input.type === 'text';
    reveal.dataset.revealed = String(revealed);
    reveal.setAttribute('aria-label', revealed ? copy.conceal : copy.reveal);
    reveal.title = reveal.getAttribute('aria-label');
    updatePose();
  }
  function setLanguage(next, remember = false) {
    language = next;
    const copy = words[language];
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : language;
    document.title = copy.heading + ' · ' + copy.brand;
    document.querySelectorAll('[data-gate-text]').forEach(node => {
      node.textContent = copy[node.dataset.gateText];
    });
    input.placeholder = copy.placeholder;
    document.querySelector('.gate-languages').setAttribute('aria-label', copy.languages);
    langs.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.gateLang === language)));
    updateControls();
    if (remember) {
      try { localStorage.setItem('lang', language); } catch { /* Optional. */ }
      const url = new URL(location.href);
      url.searchParams.set('lang', language);
      history.replaceState(history.state, '', url);
    }
  }
  function setBusy(value) {
    busy = Boolean(value);
    form.setAttribute('aria-busy', String(busy));
    input.readOnly = busy;
    submit.disabled = busy;
    reveal.disabled = busy;
    updateControls();
  }
  function presentError(type) {
    opened = false;
    document.body.classList.remove('gate-open');
    errorType = ['wrong', 'network', 'unsupported', 'empty', 'updated', 'limited', 'unavailable'].includes(type) ? type : 'network';
    const fieldError = errorType === 'wrong' || errorType === 'empty';
    input.setAttribute('aria-invalid', String(fieldError));
    setBusy(false);
    if (fieldError) {
      input.focus();
      input.select();
    }
  }
  function openGate() {
    opened = true;
    input.value = '';
    input.type = 'password';
    errorType = '';
    setBusy(true);
    document.body.classList.add('gate-open');
    if (reducedMotion.matches) return Promise.resolve();
    return new Promise(resolve => setTimeout(resolve, 400));
  }

  langs.forEach(button => button.addEventListener('click', () => setLanguage(button.dataset.gateLang, true)));
  reveal.addEventListener('click', () => {
    input.type = input.type === 'password' ? 'text' : 'password';
    updateControls();
  });
  input.addEventListener('focus', updatePose);
  input.addEventListener('blur', updatePose);
  input.addEventListener('input', () => {
    errorType = '';
    input.removeAttribute('aria-invalid');
    updateControls();
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || opened) return;
    if (!input.value.trim()) return presentError('empty');
    if (typeof window.unlockSite !== 'function') return presentError('unsupported');
    errorType = '';
    input.removeAttribute('aria-invalid');
    setBusy(true);
    try { await window.unlockSite(input.value); }
    catch { presentError('network'); }
  });
  setLanguage(initialLanguage());
  setBusy(false);
  window.gateUI = {
    get language() { return language; },
    busy: setBusy, error: presentError, opened: openGate
  };
})();

(() => {
  'use strict';
  const drawing = document.querySelector('.gate-ensemble');
  if (!drawing) return;

  const field = document.getElementById('gate-password');
  const eyes = Array.from(drawing.querySelectorAll('[data-eye]'), socket => ({
    socket,
    pupil: socket.querySelector('[data-pupil]'),
    travel: Number(socket.dataset.eye)
  }));
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let pointer = null;
  let frame = 0;

  function renderGaze() {
    frame = 0;
    if (document.hidden || !drawing.isConnected) return;
    const pose = document.body.dataset.pose;
    const concealed = pose === 'shy';
    const settled = pose === 'welcome';
    let target = concealed || settled ? null : pointer;
    if (!target && (pose === 'typing' || pose === 'error')) {
      const box = field.getBoundingClientRect();
      target = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    }

    // Each socket supplies its own origin, including its character's current
    // posture. Convert client coordinates into that socket's SVG coordinate space.
    const point = drawing.createSVGPoint();
    if (target) { point.x = target.x; point.y = target.y; }
    const offsets = eyes.map(({ socket, travel }) => {
      let x = concealed ? -.85 : 0;
      let y = settled ? -.45 : 0;
      const matrix = target && socket.getScreenCTM();
      if (matrix && matrix.a * matrix.d !== matrix.b * matrix.c) {
        const local = point.matrixTransform(matrix.inverse());
        x = Math.tanh(local.x / 110);
        y = Math.tanh(local.y / 96);
      }
      const radius = travel / Math.max(1, Math.hypot(x, y));
      return [x * radius, y * radius];
    });
    const bounds = drawing.getBoundingClientRect();
    let horizontal = 0, vertical = 0;
    if (target && !reduced.matches && bounds.width && bounds.height) {
      horizontal = Math.tanh((target.x - bounds.left - bounds.width / 2) / (bounds.width * .52));
      vertical = Math.tanh((target.y - bounds.top - bounds.height / 2) / (bounds.height * .5));
    }
    drawing.style.setProperty('--pointer-lean', (-2.2 * horizontal).toFixed(2) + 'deg');
    drawing.style.setProperty('--look-x', (9 * horizontal).toFixed(2) + 'px');
    drawing.style.setProperty('--look-y', (5 * vertical).toFixed(2) + 'px');
    eyes.forEach(({ pupil }, index) => {
      const [x, y] = offsets[index];
      pupil.style.transform = 'translate(' + x.toFixed(2) + 'px, ' + y.toFixed(2) + 'px)';
    });
  }

  function refresh() {
    if (!frame && !document.hidden && drawing.isConnected) frame = requestAnimationFrame(renderGaze);
  }
  function track(event) {
    pointer = { x: event.clientX, y: event.clientY };
    refresh();
  }
  function release() {
    pointer = null;
    refresh();
  }

  // Capture across the whole window, including controls in the form column.
  const passiveCapture = { capture: true, passive: true };
  window.addEventListener('pointermove', track, passiveCapture);
  window.addEventListener('pointerdown', track, passiveCapture);
  window.addEventListener('pointerup', event => { if (event.pointerType === 'touch') release(); }, passiveCapture);
  window.addEventListener('pointercancel', release, passiveCapture);
  window.addEventListener('pointerout', event => { if (!event.relatedTarget) release(); }, passiveCapture);
  window.addEventListener('blur', release);
  window.addEventListener('keydown', release, { capture: true });
  window.addEventListener('resize', refresh, { passive: true });
  window.addEventListener('scroll', refresh, passiveCapture);
  document.addEventListener('visibilitychange', refresh);
  reduced.addEventListener('change', refresh);
  new MutationObserver(refresh).observe(document.body, { attributes: true, attributeFilter: ['data-pose'] });
  refresh();
})();
