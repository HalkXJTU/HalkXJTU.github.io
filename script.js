document.documentElement.classList.add("js");

// English is authored in HTML; Chinese and Italian share the same keys.
const translations = [...document.querySelectorAll("[data-i18n]")].map(element => ({
  element, key: element.dataset.i18n, english: element.innerHTML
}));
const attributeTranslations = ["alt", "aria-label"].flatMap(attribute =>
  [...document.querySelectorAll(`[data-i18n-${attribute}]`)].map(element => ({
    element, attribute, key: element.getAttribute(`data-i18n-${attribute}`),
    english: element.getAttribute(attribute)
  }))
);
const EN = { "menu.open": "Open menu", "menu.close": "Close menu", "theme.dark": "Switch to dark theme", "theme.light": "Switch to light theme" };
const DICTIONARIES = { zh: ZH, it: IT };
const SUPPORTED_LANGUAGES = ["zh", "en", "it"];
const LANGUAGE_INFO = {
  zh: { html: "zh-CN", locale: "zh_CN", title: "荆昊 | 建筑与 GeoAI", description: ZH["seo.description"], imageAlt: ZH["seo.imageAlt"] },
  en: { html: "en", locale: "en_US", title: document.title, description: document.querySelector('meta[name="description"]').content, imageAlt: document.querySelector('meta[property="og:image:alt"]').content },
  it: { html: "it", locale: "it_IT", title: "Hao Jing | Architettura e GeoAI", description: IT["seo.description"], imageAlt: IT["seo.imageAlt"] }
};
const menuButton = document.querySelector(".menu-btn");
const navLinks = document.querySelector(".nav-links");
const languageButtons = [...document.querySelectorAll(".lang-toggle [data-lang]")];
const sectionLinks = [...document.querySelectorAll('.section-nav a[href^="#"]')];
let savedLanguage;
try { savedLanguage = localStorage.getItem("lang"); } catch { /* Storage can be disabled. */ }
const preferredLanguages = navigator.languages?.length ? navigator.languages : [navigator.language || "en"];
const browserLanguage = preferredLanguages.map(value => value.toLowerCase().split("-")[0])
  .find(value => SUPPORTED_LANGUAGES.includes(value)) || "en";
const requestedLanguage = new URLSearchParams(location.search).get("lang");
let lang = SUPPORTED_LANGUAGES.includes(requestedLanguage) ? requestedLanguage :
  SUPPORTED_LANGUAGES.includes(savedLanguage) ? savedLanguage : browserLanguage;

function translate(key, english) {
  return DICTIONARIES[lang]?.[key] ?? english;
}

function updateMenuLabel() {
  const key = menuButton.getAttribute("aria-expanded") === "true" ? "menu.close" : "menu.open";
  menuButton.setAttribute("aria-label", translate(key, EN[key]));
}

// Measure all translations in an inert copy at the actual responsive width.
// Minimum sizes keep section/card starts stable without hiding or clipping text.
const shell = document.querySelector(".site-shell");
const englishByKey = new Map(translations.map(({ key, english }) => [key, english]));
const compositeSelector = ".sidebar-affiliation, .education-affiliation, .sidebar-locations p, .contact-row";
const slotCandidates = new Set(shell.querySelectorAll(compositeSelector));
translations.forEach(({ element }) => {
  if (shell.contains(element) && !element.closest(".sr-only")) slotCandidates.add(element.closest(compositeSelector) || element);
});
const layoutSlots = [...slotCandidates].filter(element =>
  ![...slotCandidates].some(other => other !== element && other.contains(element))
);
layoutSlots.forEach((element, index) => {
  element.dataset.layoutSlot = String(index);
  element.classList.add("locale-slot");
});

function measureLabels(elements, probe) {
  return elements.map(element => {
    const style = getComputedStyle(element);
    probe.style.font = style.font;
    probe.style.fontWeight = "600";
    probe.style.letterSpacing = style.letterSpacing;
    return Math.ceil(Math.max(...SUPPORTED_LANGUAGES.map(language => {
      probe.innerHTML = DICTIONARIES[language]?.[element.dataset.i18n] ?? englishByKey.get(element.dataset.i18n);
      return probe.getBoundingClientRect().width;
    })));
  });
}

function stabilizeLayout() {
  const probe = document.createElement("span");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText = "position:fixed;left:-100000px;top:0;visibility:hidden;white-space:nowrap;";
  document.body.append(probe);
  try {
    const labels = [...shell.querySelectorAll(".sidebar-locations strong")];
    shell.style.setProperty("--location-label-width", `${Math.max(...measureLabels(labels, probe))}px`);
  } finally { probe.remove(); }

  const copy = shell.cloneNode(true);
  copy.classList.add("layout-measure");
  copy.style.width = `${shell.getBoundingClientRect().width}px`;
  copy.setAttribute("inert", "");
  copy.setAttribute("aria-hidden", "true");
  const copies = [...copy.querySelectorAll("[data-layout-slot]")];
  copies.forEach(element => element.style.removeProperty("--locale-slot-size"));
  const textCopies = [...copy.querySelectorAll("[data-i18n]")];
  const sizes = layoutSlots.map(() => 0);
  document.body.append(copy);
  try {
    SUPPORTED_LANGUAGES.forEach(language => {
      copy.lang = LANGUAGE_INFO[language].html;
      textCopies.forEach(element => {
        const key = element.dataset.i18n;
        element.innerHTML = DICTIONARIES[language]?.[key] ?? englishByKey.get(key);
      });
      copies.forEach(element => {
        const index = Number(element.dataset.layoutSlot);
        sizes[index] = Math.max(sizes[index], Math.ceil(element.getBoundingClientRect().height));
      });
    });
  } finally { copy.remove(); }
  layoutSlots.forEach((element, index) => element.style.setProperty("--locale-slot-size", `${sizes[index]}px`));
}

// Apply after translations too: translated fragments recreate their anchors.
function configureLinkTargets() {
  document.querySelectorAll("a[href]").forEach(link => {
    const href = link.getAttribute("href");
    if (link.hasAttribute("data-version-link") || href.startsWith("#") || !/^https?:$/.test(new URL(link.href).protocol)) return;
    link.target = "_blank";
    link.relList.add("noopener", "noreferrer");
    // These two links already include a translated new-tab announcement.
    if (!link.matches(".orcid-link, .pf-link")) {
      const descriptions = new Set((link.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean));
      descriptions.add("new-tab-hint");
      link.setAttribute("aria-describedby", [...descriptions].join(" "));
    }
  });
}

function setLang(language) {
  const scrollPosition = [window.scrollX, window.scrollY];
  lang = SUPPORTED_LANGUAGES.includes(language) ? language : "en";
  translations.forEach(({ element, key, english }) => {
    element.innerHTML = translate(key, english);
  });
  attributeTranslations.forEach(({ element, attribute, key, english }) => {
    element.setAttribute(attribute, translate(key, english));
  });
  configureLinkTargets();
  const info = LANGUAGE_INFO[lang];
  document.documentElement.lang = info.html;
  document.title = info.title;
  const metadata = {
    'meta[name="description"]': info.description,
    'meta[property="og:description"]': info.description,
    'meta[name="twitter:description"]': info.description,
    'meta[property="og:title"]': info.title,
    'meta[name="twitter:title"]': info.title,
    'meta[property="og:image:alt"]': info.imageAlt,
    'meta[name="twitter:image:alt"]': info.imageAlt,
    'meta[property="og:locale"]': info.locale
  };
  Object.entries(metadata).forEach(([selector, value]) => document.querySelector(selector).setAttribute("content", value));
  const alternateLocales = SUPPORTED_LANGUAGES.filter(value => value !== lang).map(value => LANGUAGE_INFO[value].locale);
  document.querySelectorAll('meta[property="og:locale:alternate"]').forEach((element, index) => {
    element.setAttribute("content", alternateLocales[index]);
  });
  languageButtons.forEach(button => button.setAttribute("aria-pressed", String(button.dataset.lang === lang)));
  updateMenuLabel();
  updateThemeLabel();
  publicationCarousels.forEach(carousel => carousel.updateLabels());
  document.querySelectorAll(".side-links a").forEach(a => { a.title = a.getAttribute("aria-label") || a.textContent.trim(); });
  try { localStorage.setItem("lang", lang); } catch { /* Keep the page usable without storage. */ }
  if (new URLSearchParams(location.search).has("lang")) {
    const pageURL = new URL(location.href);
    pageURL.searchParams.set("lang", lang);
    history.replaceState(null, "", pageURL);
  }
  if (window.scrollY !== scrollPosition[1] || window.scrollX !== scrollPosition[0]) {
    const root = document.documentElement;
    const previous = root.style.scrollBehavior;
    root.style.scrollBehavior = "auto";
    window.scrollTo(...scrollPosition);
    root.style.scrollBehavior = previous;
  }
}

const compactMenu = window.matchMedia("(max-width: 860px)");
const mouseHover = window.matchMedia("(hover: hover) and (pointer: fine)");
let hoverPreview = false;
let menuIntent = null;
let closeTimer;

function clearMenuIntent() {
  clearTimeout(closeTimer);
  menuIntent = null;
}

function openMenu(preview = false) {
  clearMenuIntent();
  hoverPreview = preview;
  navLinks.classList.add("open");
  menuButton.setAttribute("aria-expanded", "true");
  updateMenuLabel();
}

function closeMenu(restoreFocus = false) {
  clearMenuIntent();
  hoverPreview = false;
  navLinks.classList.remove("open");
  menuButton.setAttribute("aria-expanded", "false");
  updateMenuLabel();
  if (restoreFocus) menuButton.focus();
}

// Menu aim geometry: protect the route to the nearest edge of the submenu.
// BEGIN MENU GEOMETRY
function pointInRect(point, rect) {
  return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
}

function pointInTriangle(point, a, b, c) {
  const cross = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  if (Math.abs(cross(a, b, c)) < 0.001) return false;
  const signs = [cross(a, b, point), cross(b, c, point), cross(c, a, point)];
  return signs.every(value => value >= -0.01) || signs.every(value => value <= 0.01);
}

function inSafeTriangle(point, origin, rect, buffer = 8) {
  if (pointInRect(point, rect)) return true;
  let a, b;
  if (origin.y <= rect.top) {
    a = { x: rect.left - buffer, y: rect.top + buffer };
    b = { x: rect.right + buffer, y: rect.top + buffer };
  } else if (origin.y >= rect.bottom) {
    a = { x: rect.left - buffer, y: rect.bottom - buffer };
    b = { x: rect.right + buffer, y: rect.bottom - buffer };
  } else if (origin.x <= rect.left) {
    a = { x: rect.left + buffer, y: rect.top - buffer };
    b = { x: rect.left + buffer, y: rect.bottom + buffer };
  } else {
    a = { x: rect.right - buffer, y: rect.top - buffer };
    b = { x: rect.right - buffer, y: rect.bottom + buffer };
  }
  return pointInTriangle(point, origin, a, b);
}
// END MENU GEOMETRY

function armMenuIntent(event, destination) {
  if (!hoverPreview || event.pointerType !== "mouse") return;
  clearMenuIntent();
  menuIntent = { origin: { x: event.clientX, y: event.clientY }, destination, deadline: performance.now() + 450, outside: false };
  closeTimer = setTimeout(() => closeMenu(), 450);
}

menuButton.addEventListener("pointerenter", event => {
  if (event.pointerType === "mouse" && compactMenu.matches && mouseHover.matches) {
    if (!navLinks.classList.contains("open")) openMenu(true);
    else clearMenuIntent();
  }
});
menuButton.addEventListener("pointerleave", event => armMenuIntent(event, navLinks));
navLinks.addEventListener("pointerenter", () => clearMenuIntent());
navLinks.addEventListener("pointerleave", event => armMenuIntent(event, menuButton));
navLinks.addEventListener("focusin", () => { clearMenuIntent(); hoverPreview = false; });
document.addEventListener("pointermove", event => {
  if (!menuIntent || event.pointerType !== "mouse") return;
  const point = { x: event.clientX, y: event.clientY };
  if (pointInRect(point, menuButton.getBoundingClientRect()) || pointInRect(point, navLinks.getBoundingClientRect())) {
    clearMenuIntent();
    return;
  }
  const safe = performance.now() < menuIntent.deadline && inSafeTriangle(point, menuIntent.origin, menuIntent.destination.getBoundingClientRect());
  if (safe && menuIntent.outside) {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => closeMenu(), Math.max(0, menuIntent.deadline - performance.now()));
  } else if (!safe && !menuIntent.outside) {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => closeMenu(), 90);
  }
  menuIntent.outside = !safe;
}, { passive: true });


const themeButton = document.querySelector(".theme-toggle");
const topButton = document.querySelector(".back-to-top");
let theme = "light";
try { if (localStorage.getItem("academic-theme") === "dark") theme = "dark"; } catch { /* optional storage */ }
document.documentElement.dataset.theme = theme;
function updateThemeLabel() {
  const dark = document.documentElement.dataset.theme === "dark";
  const key = dark ? "theme.light" : "theme.dark";
  themeButton.setAttribute("aria-label", translate(key, EN[key]));
  themeButton.setAttribute("aria-pressed", String(dark));
  themeButton.querySelector("i").className = `fa-solid ${dark ? "icon-sun" : "icon-moon"}`;
}
themeButton.addEventListener("click", () => {
  theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem("academic-theme", theme); } catch { /* optional storage */ }
  updateThemeLabel();
});
topButton.addEventListener("click", () => {
  document.querySelector("#about").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  const about = document.querySelector("#about");
  about.setAttribute("tabindex", "-1");
  about.focus({ preventScroll: true });
});
window.addEventListener("scroll", () => { topButton.hidden = window.scrollY < 600; }, { passive: true });

// Each article owns its slides. Hidden figures load only when selected.
// Autoplay pauses off screen, on hover/focus, and for reduced-motion preferences.
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const publicationCarousels = [...document.querySelectorAll(".pub-carousel")].map(element => {
  const slides = [...element.querySelectorAll(".pub-slide")];
  const dots = [...element.querySelectorAll(".carousel-dot")];
  const dotStrip = element.querySelector(".carousel-dots");
  const playButton = element.querySelector(".carousel-play");
  const counter = element.querySelector(".carousel-count");
  const status = element.querySelector(".carousel-status");
  let index = 0;
  let paused = reducedMotion.matches;
  let hovering = false;
  let focused = false;
  let visible = false;
  let timer;
  let touchStart;
  let suppressImageClick = false;

  function updateLabels() {
    const stopped = paused;
    const key = stopped ? "gallery.play" : "gallery.pause";
    playButton.setAttribute("aria-label", translate(key, key === "gallery.play" ? "Play slideshow" : "Pause slideshow"));
    playButton.setAttribute("aria-pressed", String(!stopped));
    playButton.querySelector("i").className = `fa-solid ${stopped ? "icon-play" : "icon-pause"}`;
    status.textContent = "";
  }
  function schedule() {
    clearTimeout(timer);
    if (!paused && !hovering && !focused && visible && !document.hidden) {
      timer = setTimeout(() => { show(index + 1); schedule(); }, 6000);
    }
  }
  function show(next, announce = false) {
    index = (next + slides.length) % slides.length;
    slides.forEach((slide, i) => { slide.hidden = i !== index; });
    dots.forEach((dot, i) => {
      dot.setAttribute("aria-pressed", String(i === index));
      dot.tabIndex = i === index ? 0 : -1;
    });
    counter.textContent = `${index + 1} / ${slides.length}`;
    const activeDot = dots[index];
    const left = activeDot.offsetLeft;
    if (left < dotStrip.scrollLeft) dotStrip.scrollLeft = left;
    else if (left + activeDot.offsetWidth > dotStrip.scrollLeft + dotStrip.clientWidth) {
      dotStrip.scrollLeft = left + activeDot.offsetWidth - dotStrip.clientWidth;
    }
    if (announce) status.textContent = `${index + 1} / ${slides.length}: ${slides[index].querySelector("figcaption").textContent}`;
  }
  function select(next) { show(next, true); schedule(); }
  element.querySelector(".carousel-prev").addEventListener("click", () => select(index - 1));
  element.querySelector(".carousel-next").addEventListener("click", () => select(index + 1));
  dots.forEach((dot, i) => dot.addEventListener("click", () => select(i)));
  playButton.addEventListener("click", () => { paused = !paused; updateLabels(); schedule(); });
  element.addEventListener("mouseenter", () => { hovering = true; schedule(); });
  element.addEventListener("mouseleave", () => { hovering = false; schedule(); });
  element.addEventListener("focusin", () => { focused = true; schedule(); });
  element.addEventListener("focusout", event => {
    focused = element.contains(event.relatedTarget);
    schedule();
  });
  element.addEventListener("keydown", event => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    select(event.key === "Home" ? 0 : event.key === "End" ? slides.length - 1 : index + (event.key === "ArrowRight" ? 1 : -1));
    if (event.target.classList.contains("carousel-dot")) dots[index].focus({ preventScroll: true });
  });
  element.querySelector(".pub-slides").addEventListener("pointerdown", event => {
    suppressImageClick = false;
    if (event.pointerType === "touch" && !event.target.closest("button")) touchStart = { x: event.clientX, y: event.clientY };
  }, { passive: true });
  element.querySelector(".pub-slides").addEventListener("pointerup", event => {
    if (!touchStart) return;
    const dx = event.clientX - touchStart.x;
    const dy = event.clientY - touchStart.y;
    touchStart = null;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      suppressImageClick = true;
      select(index + (dx < 0 ? 1 : -1));
    }
  }, { passive: true });
  element.addEventListener("click", event => {
    if (suppressImageClick && event.target.closest(".pub-image-link")) event.preventDefault();
    suppressImageClick = false;
  }, true);
  element.addEventListener("pointercancel", () => { touchStart = null; });
  document.addEventListener("visibilitychange", schedule);
  reducedMotion.addEventListener("change", () => { if (reducedMotion.matches) paused = true; updateLabels(); schedule(); });
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(entries => {
      visible = entries[0].isIntersecting;
      schedule();
    }, { threshold: 0.2 }).observe(element);
  } else { visible = true; schedule(); }
  show(0);
  return { updateLabels };
});

stabilizeLayout();
setLang(lang);
let resizeFrame;
window.addEventListener("resize", () => {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(stabilizeLayout);
});
document.fonts?.ready.then(stabilizeLayout);
document.fonts?.addEventListener("loadingdone", stabilizeLayout);
languageButtons.forEach(button => button.addEventListener("click", () => setLang(button.dataset.lang)));
menuButton.addEventListener("click", event => {
  if (hoverPreview) openMenu();
  else if (navLinks.classList.contains("open")) closeMenu();
  else openMenu();
  if (event.detail === 0 && navLinks.classList.contains("open")) navLinks.querySelector("a").focus();
});
sectionLinks.forEach(link => link.addEventListener("click", () => {
  closeMenu();
  sectionLinks.forEach(item => { if (item === link) item.setAttribute("aria-current", "location"); else item.removeAttribute("aria-current"); });
  const section = document.querySelector(link.getAttribute("href"));
  section.setAttribute("tabindex", "-1");
  section.focus({ preventScroll: true });
}));
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && navLinks.classList.contains("open")) closeMenu(true);
});
document.addEventListener("click", event => {
  if (!event.target.closest(".view-toolbar, .sidebar-nav")) closeMenu();
});
compactMenu.addEventListener("change", () => closeMenu());

if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        sectionLinks.forEach(link => {
          if (link.hash === `#${entry.target.id}`) link.setAttribute("aria-current", "location");
          else link.removeAttribute("aria-current");
        });
      }
    });
  }, { rootMargin: "-12% 0px -65% 0px", threshold: 0 });
  document.querySelectorAll("main > section[id]").forEach(section => observer.observe(section));
}
