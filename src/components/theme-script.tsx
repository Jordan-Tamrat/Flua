/**
 * Applies the saved theme before first paint.
 *
 * This has to run as a blocking inline script: if the class were applied in an
 * effect, a dark-mode user would see a white flash on every page load. The
 * script is self-contained and touches only `documentElement.classList`.
 */
const THEME_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem("flua-theme");
    var root = document.documentElement;
    root.classList.remove("light", "dark");
    if (stored === "light" || stored === "dark") {
      root.classList.add(stored);
    }
    // "system" (or nothing stored) leaves both classes off so the
    // prefers-color-scheme fallback in globals.css takes over.
  } catch (error) {
    // Private browsing can throw on localStorage access; the default theme is fine.
  }
})();
`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />;
}

export const THEME_STORAGE_KEY = "flua-theme";
