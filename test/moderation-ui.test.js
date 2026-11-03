const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const portalCopies = [
  path.join(__dirname, ".."),
  path.join(__dirname, "..", "nyrp")
];

test("moderation workspace removes the toolbox and keeps its functional controls", () => {
  for (const portalPath of portalCopies) {
    const html = fs.readFileSync(path.join(portalPath, "index.html"), "utf8");
    const panelStart = html.indexOf('<div id="moderation-panel-shell"');
    const panelEnd = html.indexOf('<section class="route-page department-page"', panelStart);
    assert.notEqual(panelStart, -1, "moderation panel should exist");
    assert.notEqual(panelEnd, -1, "moderation panel should have a closing section boundary");

    const panel = html.slice(panelStart, panelEnd);
    assert.doesNotMatch(panel, /moderation-toolbox|Toolbox/);
    for (const id of [
      "moderation-shift-button",
      "moderation-user-search",
      "moderation-type",
      "moderation-reason",
      "moderation-log-form",
      "moderation-logs-search",
      "moderation-logs-list"
    ]) {
      assert.match(panel, new RegExp(`id="${id}"`), `${id} should remain available`);
    }

    const styles = fs.readFileSync(path.join(portalPath, "styles.css"), "utf8");
    assert.match(styles, /\.moderation-grid\s*\{[^}]*grid-template-columns/s);
    assert.match(styles, /@media \(max-width: 760px\)[\s\S]*?\.moderation-grid/);
  }
});
