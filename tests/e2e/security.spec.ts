import { expect, test } from "@playwright/test";
import { E2E_ADMIN_TOKEN } from "../../playwright.config";

test.describe("security + platform", () => {
  test("job and media endpoints don't leak", async ({ request }) => {
    expect((await request.get("/api/generations/00000000-0000-4000-8000-000000000000")).status()).toBe(404);
    expect((await request.get("/api/generations/../../etc/passwd")).status()).toBe(404);
    expect((await request.get("/api/media/sources/abcdefgh12345678.jpg?exp=9999999999&sig=x")).status()).toBe(
      404,
    );
    expect((await request.get("/api/media/results/abcdefgh12345678.mp4")).status()).toBe(403);
    expect((await request.get("/api/cron/tick")).status()).toBe(404);
    expect((await request.post("/api/admin/trends/ingest", { data: {} })).status()).toBe(404);
  });

  test("state-changing requests from other origins are rejected", async ({ request }) => {
    const r = await request.post("/api/uploads", {
      headers: { Origin: "https://evil.example", "Content-Type": "image/png" },
      data: Buffer.from("x"),
    });
    expect(r.status()).toBe(403);
    const d = await request.delete("/api/me", { headers: { Origin: "https://evil.example" } });
    expect(d.status()).toBe(403);
  });

  test("security headers and PWA manifest", async ({ request }) => {
    const home = await request.get("/");
    expect(home.headers()["x-content-type-options"]).toBe("nosniff");
    expect(home.headers()["x-frame-options"]).toBe("DENY");
    expect(home.headers()["x-powered-by"]).toBeUndefined();
    expect(home.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
    const m = await (await request.get("/manifest.webmanifest")).json();
    expect(m).toMatchObject({ display: "standalone", orientation: "portrait", theme_color: "#07070a" });
    expect((await request.get("/icons/512")).headers()["content-type"]).toBe("image/png");
    expect((await request.get("/sw.js")).ok()).toBeTruthy();
  });

  test("admin requires the token; wrong tokens are refused", async ({ page }) => {
    await page.goto("/admin/jobs");
    await expect(page.getByRole("heading", { name: /admin sign-in/i })).toBeVisible();
    await expect(page.getByText("Generation jobs")).toHaveCount(0);
    await page.getByLabel("Admin token").fill("x".repeat(40));
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Invalid token.")).toBeVisible();
    await page.getByLabel("Admin token").fill(E2E_ADMIN_TOKEN);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    await expect(page.getByText("no credentials").first()).toBeVisible();
    await page.getByRole("link", { name: "Reference motion" }).click();
    await expect(page.getByText(/templates waiting for reference motion \(3\)/i)).toBeVisible();
    await page.getByRole("link", { name: "Templates" }).click();
    await expect(page.getByText("REFERENCE_MOTION_PENDING").first()).toBeVisible();
  });

  test("trend scanner ingestion needs its token", async ({ request }) => {
    const r = await request.post("/api/admin/trends/ingest", {
      headers: { Authorization: "Bearer wrong-token-wrong-token-wrong" },
      data: {},
    });
    expect(r.status()).toBe(404);
  });
});
