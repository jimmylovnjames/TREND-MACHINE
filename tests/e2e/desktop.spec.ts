import { expect, test } from "@playwright/test";

test("desktop: keyboard navigation reaches the primary CTA", async ({ page }) => {
  await page.goto("/d/zero-gravity-shuffle");
  const cta = page.getByRole("link", { name: /use this dance/i });
  await expect(cta).toBeVisible();
  for (let i = 0; i < 30 && !(await cta.evaluate((el) => el === document.activeElement)); i++)
    await page.keyboard.press("Tab");
  await expect(cta).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/make$/);
});
