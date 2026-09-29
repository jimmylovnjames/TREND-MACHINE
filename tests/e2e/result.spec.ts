import { expect, test } from "@playwright/test";
import { seedCompletedJob } from "./helpers";

test("result screen offers replay, regenerate, download and share, labelled as AI", async ({
  page,
  context,
}) => {
  await page.goto("/");
  // Mint the anonymous device cookie (any state-changing same-origin call does).
  const ev = await page.request.post("/api/events", {
    headers: { Origin: "http://localhost:3200" },
    data: { events: [{ name: "app_open", at: Date.now(), sessionId: "e2e-session-1" }] },
  });
  expect(ev.status()).toBe(204);
  const id = await seedCompletedJob(context);
  await page.goto(`/g/${id}`);
  await expect(page.getByText("AI-generated", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Share" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Download" })).toHaveAttribute(
    "href",
    /\/api\/media\/results\/.+dl=trend-machine-rubber-legs-ai\.mp4/,
  );
  await expect(page.getByRole("button", { name: "Replay" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Regenerate" })).toBeVisible();

  // The signed media URL works and supports Range requests (iOS Safari requirement).
  const href = await page.getByRole("link", { name: "Download" }).getAttribute("href");
  const ranged = await page.request.get(href!, { headers: { Range: "bytes=0-7" } });
  expect(ranged.status()).toBe(206);
  expect(ranged.headers()["content-range"]).toMatch(/^bytes 0-7\/\d+$/);
  // Tampered signature is rejected.
  const tampered = await page.request.get(href!.replace(/sig=[^&]+/, "sig=AAAA"));
  expect(tampered.status()).toBe(403);

  // Share link is result-only and public.
  const share = await page.request.post(`/api/generations/${id}/share`, {
    headers: { Origin: "http://localhost:3200" },
  });
  expect(share.ok()).toBeTruthy();
  const { share: s } = await share.json();
  const anon = await page.context().browser()!.newContext();
  const sp = await anon.newPage();
  await sp.goto(`http://localhost:3200${s.path}`);
  await expect(sp.getByText("AI-generated", { exact: true }).first()).toBeVisible();
  await expect(sp.getByRole("link", { name: /make your own/i })).toHaveAttribute("href", "/d/rubber-legs");
  // Another device cannot read the job itself.
  const other = await sp.request.get(`/api/generations/${id}`);
  expect(other.status()).toBe(404);
  await anon.close();

  // Regenerate reuses the original photo. The seeded job has none (photos expire after 24h),
  // so the app must say so and offer to add it again — not pretend or silently fail.
  await page.getByRole("button", { name: "Regenerate" }).click();
  await expect(page.getByText(/photo has expired/i)).toBeVisible();
  await page.getByRole("button", { name: /add photo again/i }).click();
  await expect(page).toHaveURL(/\/d\/rubber-legs\/make$/);
});
