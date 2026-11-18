// Each layout is a real static page. Preserve language and section on switching.
function refreshVersionLinks() {
  const language = document.documentElement.lang.split("-")[0];
  document.querySelectorAll("[data-version-link]").forEach(link => {
    const destination = new URL(link.dataset.versionLink, location.href);
    destination.searchParams.set("lang", language);
    destination.hash = location.hash;
    if (link.dataset.versionLink === "legacy.html" && destination.hash === "#education") destination.hash = "#about";
    link.href = destination.href;
    link.target = "_self";
  });
}
refreshVersionLinks();
window.addEventListener("hashchange", refreshVersionLinks);
document.addEventListener("click", event => {
  if (event.target.closest("[data-version-link], [data-lang]")) refreshVersionLinks();
});
