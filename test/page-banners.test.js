const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const expectedBanners = {
  vehicles: "license-motor.webp",
  shop: "license-fishing.webp",
  businesses: "license-firearms-hunting.webp",
  wallet: "license-boating.webp",
  events: "license-commercial.webp"
};

test("requested route headers use their supplied local banner assets in both portal copies", () => {
  const projectRoot = path.resolve(__dirname, "..");

  for (const appDirectory of ["", "nyrp"]) {
    const appRoot = path.join(projectRoot, appDirectory);
    const styles = fs.readFileSync(path.join(appRoot, "styles.css"), "utf8");

    for (const [route, filename] of Object.entries(expectedBanners)) {
      const selector = `.route-page[data-page="${route}"] .page-heading`;
      const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const rule = styles.match(new RegExp(`${escapedSelector}\\s*\\{[^}]*url\\("/assets/${filename}"\\)`));
      assert.ok(rule, `missing page header styles for ${route}`);

      const asset = fs.readFileSync(path.join(appRoot, "public", "assets", filename));
      assert.equal(asset.subarray(8, 12).toString("ascii"), "WEBP", filename);
    }
  }
});
