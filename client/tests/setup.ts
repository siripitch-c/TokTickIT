import "@testing-library/jest-dom";

// jsdom has no matchMedia, which useMediaQuery needs to decide between the
// desktop table and the mobile cards (ui-spec.md §6.3). The default here
// matches nothing, i.e. the desktop layout; a test that wants the mobile one
// replaces window.matchMedia for the width it cares about.
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
