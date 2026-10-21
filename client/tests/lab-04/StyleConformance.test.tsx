import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// tests.md UI-STYLE-01, UI-STYLE-02, UI-LINK-01; specification.md FR-26.
//
// What static analysis can prove about the rendered markup. Both checks exist
// because the handout §8.5 asks for "console errors, broken links, placeholder
// text, and unfinished controls" to be removed, and a component test cannot see
// any of those: it asserts text and roles, not which stylesheet rule applied or
// where a link leads.
//
// Three defects in this sprint were the same defect: a class name written into
// a component that no rule in the stylesheet ever matched, so the element
// rendered unstyled and every component test still passed. `.zg-conflict`
// (Issue #47, found by eye in Issue #48), `zg-field-row--2` (Issue #47, found
// by opening a screenshot), and four more in Issue #51 - `zg-state`,
// `zg-callout`, `zg-user-status` and `zg-queue-card`, each a base class that
// only one screen carried while six others used the modifier alone.
//
// A component test asserts text and roles; it cannot see which rule applies.
// This one reads the stylesheet instead, so the fourth time cannot happen.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "..", "..", "src");
const STYLESHEET = path.join(SRC, "styles", "zen-green.css");

/** Class names a rule in `zen-green.css` actually matches. */
function definedClasses(): Set<string> {
  const css = fs.readFileSync(STYLESHEET, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  return new Set([...css.matchAll(/\.(zg-[A-Za-z0-9_-]+)/g)].map((m) => m[1]));
}

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/**
 * Every `zg-` class the source puts in a `className`, with the file that does
 * it. Comments are stripped first, so a class discussed in a comment is not
 * mistaken for one that renders. A class assembled from a template literal
 * (`zg-badge--status-${slug}`) contributes only its literal fragments, which is
 * why the reverse direction - a rule nothing uses - is not asserted here.
 */
function usedClasses(): Map<string, Set<string>> {
  const used = new Map<string, Set<string>>();

  for (const file of sourceFiles(SRC)) {
    const text = fs
      .readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*/g, "");
    const where = path.relative(SRC, file).replace(/\\/g, "/");

    for (const attribute of text.matchAll(/className=(\{[^}]*\}|"[^"]*")/g)) {
      for (const literal of attribute[1].matchAll(/["'`]([^"'`]*)["'`]/g)) {
        for (const raw of literal[1].split(/[\s$]+/)) {
          const cls = raw.replace(/[{}]/g, "");
          // A fragment ending the literal before an interpolation is a prefix,
          // not a whole class name, and the full name only exists at runtime.
          if (!cls.startsWith("zg-") || literal[1].endsWith(raw + "$")) continue;
          if (!used.has(cls)) used.set(cls, new Set());
          used.get(cls)!.add(where);
        }
      }
    }
  }

  return used;
}

describe("Zen Green style conformance", () => {
  it("UI-STYLE-01 / FR-26: every class name the components render has a rule in the stylesheet", () => {
    const defined = definedClasses();
    const orphans = [...usedClasses()]
      .filter(([cls]) => !defined.has(cls))
      .map(([cls, files]) => `${cls} (${[...files].sort().join(", ")})`)
      .sort();

    // Named in the message rather than counted, so a failure says which class
    // and which file instead of only that the number changed.
    expect(orphans, `class names with no rule in zen-green.css:\n  ${orphans.join("\n  ")}`).toEqual([]);
  });

  it("UI-LINK-01 / FR-26: every link the interface renders leads to a route the router defines", () => {
    // Handout §8.5: "broken links ... are removed". A `<Link to="/old-screen">`
    // left behind by an earlier sprint renders, is clickable, and lands on the
    // catch-all redirect - so it looks like a working link to a test and like a
    // dead end to a person. Nothing else in the suite follows a link target to
    // the route table.
    const app = fs.readFileSync(path.join(SRC, "App.tsx"), "utf8");
    const routes = [...app.matchAll(/<Route\s[^>]*path="([^"]+)"/g)].map((m) => m[1]);
    expect(routes.length, "no routes parsed from App.tsx").toBeGreaterThan(8);

    /**
     * `/tickets/:id` matches `/tickets/118`; `*` matches nothing on purpose.
     *
     * What this cannot catch, found while proving it: a link to
     * `/tickets/create-old` also matches `/tickets/:id`, so it passes here and
     * then renders the not-found state at runtime. The check finds a link to a
     * screen that no longer exists - the removed `/select-requester` is the
     * shape it is built for - and not a parameter that is not an id.
     */
    const defines = (target: string) =>
      routes.some((route) => {
        if (route === "*") return false;
        const r = route.split("/").filter(Boolean);
        const t = target.split("/").filter(Boolean);
        return r.length === t.length && r.every((part, i) => part.startsWith(":") || part === t[i]);
      });

    const broken: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const text = fs
        .readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*/g, "");
      const where = path.relative(SRC, file).replace(/\\/g, "/");

      for (const link of text.matchAll(/\bto=\{?[`"]([^`"]+)[`"]/g)) {
        // An interpolation stands for one path segment, and the query string is
        // not part of the route.
        const target = link[1].replace(/\$\{[^}]*\}/g, "1").split(/[?#]/)[0];
        if (!target.startsWith("/")) continue;
        if (!defines(target)) broken.push(`${target} (${where})`);
      }
    }

    expect(broken, `links with no route behind them:\n  ${broken.join("\n  ")}`).toEqual([]);
  });

  it("UI-STYLE-02 / FR-26: the stylesheet is read, so the check cannot pass by finding nothing", () => {
    // The guard on the guard. If either side silently collected nothing - a
    // moved stylesheet, a renamed source folder - UI-STYLE-01 would pass while
    // asserting nothing at all, which is the failure mode a conformance test
    // most easily hides.
    expect(definedClasses().size).toBeGreaterThan(150);
    expect(usedClasses().size).toBeGreaterThan(150);
    expect(definedClasses().has("zg-metric")).toBe(true);
  });
});
