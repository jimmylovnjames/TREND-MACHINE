import { expect, test } from "@playwright/test";
import { fixturePhoto } from "./helpers";

test.describe("core flow: home > template > photo > crop > rights > generate > truthful result", () => {
  test("walks the whole consumer journey and ends in a precise, truthful failure", async ({ page }, info) => {
    const photo = fixturePhoto(info.outputDir);
    const cspViolations: string[] = [];
    page.on("console", (m) => /Content Security Policy/i.test(m.text()) && cspViolations.push(m.text()));

    await page.goto("/");
    await expect(page.getByText("TREND MACHINE").first()).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/make the\s*next\s*move/i);
    // No fabricated social proof anywhere on the home screen.
    const body = (await page.locator("main").innerText()).toLowerCase();
    for (const fake of ["views", "likes", "viral", "users", "trend score"]) expect(body).not.toContain(fake);
    await expect(page.getByText(/no trending moves yet/i)).toBeVisible();

    await page
      .getByRole("link", { name: /glitch walk/i })
      .first()
      .click();
    await expect(page).toHaveURL(/\/d\/glitch-walk$/);
    await expect(page.getByRole("heading", { name: "Glitch Walk" })).toBeVisible();
    await expect(page.getByText(/this dance can.t render yet/i).first()).toBeVisible();
    await expect(page.getByText(/motion sketch, not a generated video/i)).toBeVisible();

    await page.getByRole("link", { name: /use this dance/i }).click();
    await expect(page).toHaveURL(/\/d\/glitch-walk\/make$/);
    await expect(page.getByRole("heading", { name: /add a full-body photo/i })).toBeVisible();

    await page.locator('input[type="file"]').first().setInputFiles(photo);
    await expect(page.getByRole("application", { name: /photo position/i })).toBeVisible();
    // Zoom via the accessible slider, then continue.
    await page.getByRole("slider", { name: "Zoom" }).fill("1.2");
    await page.getByRole("button", { name: /looks good/i }).click();

    const make = page.getByRole("button", { name: /make my video/i });
    await expect(make).toBeDisabled();
    await page.getByRole("checkbox").check();
    await expect(make).toBeEnabled();
    await make.click();

    await expect(page).toHaveURL(/\/g\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    await expect(page.getByRole("heading", { name: /isn.t recorded yet/i })).toBeVisible();
    await expect(page.getByText(/also needed: no video-generation engine is connected/i)).toBeVisible();
    await expect(page.getByRole("link", { name: /pick another dance/i })).toBeVisible();

    // Survives a refresh: state comes from the server, not the tab.
    await page.reload();
    await expect(page.getByRole("heading", { name: /isn.t recorded yet/i })).toBeVisible();

    await page.goto("/me");
    await expect(page.getByText("Glitch Walk")).toBeVisible();
    await expect(page.getByText("Didn't work")).toBeVisible();
    expect(cspViolations).toEqual([]);
  });

  test("rejects an unusable file with a helpful message", async ({ page }, info) => {
    await page.goto("/d/rubber-legs/make");
    const bad = `${info.outputDir}/not-an-image.jpg`;
    await import("node:fs").then((fs) => {
      fs.mkdirSync(info.outputDir, { recursive: true });
      fs.writeFileSync(bad, "definitely not a jpeg");
    });
    await page.locator('input[type="file"]').first().setInputFiles(bad);
    await expect(page.getByText(/couldn.t open that photo/i)).toBeVisible();
  });
});
