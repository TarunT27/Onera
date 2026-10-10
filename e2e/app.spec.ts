import { test, expect, type Page } from "@playwright/test";
// Pure data module (governance copy); shared with the UI so wording can't drift.
import { HOLD_MESSAGES } from "../lib/policy/messages";

// Every run owns a separate synthetic DB and port. Never reset a developer's DB.
test.beforeEach(async ({ request }) => {
  const res = await request.post("/api/demo/reset");
  expect(res.ok()).toBeTruthy();
});
async function checkLayout(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBeTruthy();
}
async function createRent(page: Page) {
  await page.goto("/transfers");
  await page
    .getByLabel("From", { exact: true })
    .selectOption("acct_alice_checking");
  await page
    .getByLabel("To", { exact: true })
    .selectOption("rcp_alice_landlord");
  await page.getByLabel("Amount", { exact: false }).fill("1850");
  await page
    .getByRole("button", { name: "Create transfer proposal", exact: true })
    .click();
  await expect(page).toHaveURL(/id=/);
}

test("all navigation, overview links, evidence and responsive layout", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page).toHaveTitle("ClearFi");
  await expect(
    page.getByRole("heading", {
      name: /^Good (morning|afternoon|evening), Alice\.$/,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Individual Brokerage", { exact: true }),
  ).toBeVisible();
  await checkLayout(page);
  await page.getByText("View details", { exact: true }).click();
  await expect(
    page.getByText("Based on your synthetic transaction history."),
  ).toBeVisible();
  await page.getByRole("link", { name: /Everyday Checking/ }).click();
  await expect(page).toHaveURL(/accounts\?id=/);
  await expect(
    page.getByRole("heading", { name: "Everyday Checking" }),
  ).toBeVisible();
  for (const [label, heading] of <[string, string | RegExp][]>[
    ["Transfers", "Transfers"],
    ["Assistant", "Ask ClearFi"],
    ["Trade", "Trade"],
    ["Controls", "Control"],
    ["Accounts", "Your accounts"],
    ["Overview", /^Good (morning|afternoon|evening), Alice\.$/],
  ]) {
    await page
      .getByRole("navigation", { name: "Main" })
      .getByRole("link", { name: label, exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: heading, exact: true }).first(),
    ).toBeVisible();
    await checkLayout(page);
    if (label === "Controls") {
      await page
        .getByText("View event details", { exact: true })
        .first()
        .click();
      await expect(page.locator("details[open] pre").first()).toBeVisible();
    }
  }
  await page.getByRole("link", { name: "New transfer", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Create transfer proposal" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("accounts search, currency, holdings and preselected transfer source", async ({
  page,
  request,
}) => {
  await page.goto("/accounts");
  await expect(
    page.getByRole("button", { name: /Everyday Checking/ }),
  ).toBeVisible();
  const activity = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Recent activity", exact: true }),
  });
  await expect(activity.getByRole("listitem")).toHaveCount(16);
  const scrollArea = activity.getByRole("region", { name: "Scrollable transactions" });
  const pageHeight = await page.locator("body").evaluate((el) => el.scrollHeight);
  await scrollArea.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await expect(activity.getByRole("listitem")).toHaveCount(32);
  expect(await page.locator("body").evaluate((el) => el.scrollHeight)).toBe(pageHeight);
  await page.getByLabel("Account type").selectOption("checking");
  const accountResponse = await request.get("/api/accounts");
  const { accounts: accountRows } = await accountResponse.json();
  const checkingIds = accountRows.filter((a: { type: string }) => a.type === "checking").map((a: { id: string }) => a.id);
  await expect(activity.locator("li[data-account-id]").first()).toBeVisible();
  const activityIds = await activity.locator("li[data-account-id]").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-account-id")));
  expect(activityIds.every((id) => checkingIds.includes(id))).toBe(true);
  await page.getByLabel("Account type").selectOption("all");
  await page.getByLabel("Search accounts or activity").fill("no-such-account");
  await expect(page.getByText(/No matching accounts/)).toBeVisible();
  await page.getByLabel("Search accounts or activity").fill("");
  await page.getByLabel("Account type").selectOption("brokerage");
  await page.getByRole("button", { name: /Individual Brokerage/ }).click();
  await expect(
    page.getByRole("heading", { name: "Holdings", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("listitem").filter({ hasText: "VTI" }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "All accounts", exact: true }).click();
  await page.getByLabel("Account type").selectOption("all");
  await page.getByRole("button", { name: /High-Yield Savings/ }).click();
  await page.getByRole("link", { name: "Transfer from this account" }).click();
  await expect(page.getByLabel("From", { exact: true })).toHaveValue(
    "acct_alice_savings",
  );
  await page.goto("/accounts");
  await page.getByLabel("Search accounts or activity").fill("Barclays");
  await expect(page.getByRole("button", { name: /£/ }).first()).toBeVisible();
  const barclaysIds = accountRows.filter((a: { institution: string }) => a.institution.includes("Barclays")).map((a: { id: string }) => a.id);
  await expect(activity.locator("li[data-account-id]").first()).toBeVisible();
  expect(await activity.locator("li[data-account-id]").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-account-id")))).toEqual(expect.arrayContaining([barclaysIds[0]]));
  expect((await activity.locator("li[data-account-id]").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-account-id")))).every((id) => barclaysIds.includes(id))).toBe(true);
  await checkLayout(page);
});

test("link sync outage reconnect disconnect and relink a simulated bank", async ({
  page,
}) => {
  await page.goto("/accounts");
  await page
    .getByRole("button", { name: "Link demo bank", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Link RBC Royal Bank", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Sync complete" }),
  ).toBeVisible();
  const bank = page.locator("article").filter({
    has: page.getByRole("heading", {
      name: "RBC Royal Bank (simulated)",
      exact: true,
    }),
  });
  await bank.getByRole("button", { name: "Sync now", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Sync complete" }),
  ).toBeVisible();
  await bank.getByText("Demo scenarios", { exact: true }).click();
  await bank.getByRole("button", { name: "Simulate expired login" }).click();
  await expect(
    bank.getByRole("button", { name: "Reconnect", exact: true }),
  ).toBeVisible();
  await bank.getByRole("button", { name: "Reconnect", exact: true }).click();
  await expect(
    bank.getByRole("button", { name: "Sync now", exact: true }),
  ).toBeVisible();
  await bank.getByText("Demo scenarios", { exact: true }).click();
  await bank.getByRole("button", { name: "Simulate outage" }).click();
  await expect(bank.getByText(/temporarily unavailable/)).toBeVisible();
  await bank.getByRole("button", { name: "Sync now", exact: true }).click();
  await expect(bank.getByText(/healthy/)).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await bank.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(
    bank.getByRole("button", { name: "Relink", exact: true }),
  ).toBeVisible();
  await bank.getByRole("button", { name: "Relink", exact: true }).click();
  await expect(
    bank.getByRole("button", { name: "Sync now", exact: true }),
  ).toBeVisible();
  await checkLayout(page);
});

test("held transfer verification, exact approval, execution and duplicate receipt", async ({
  page,
}) => {
  await createRent(page);
  const changed = HOLD_MESSAGES.RECIPIENT_CHANGED;
  const why = page.getByRole("region", {
    name: "Why ClearFi held this transfer",
  });
  await expect(why.getByText(changed.label, { exact: true })).toBeVisible();
  await expect(why.getByText(changed.explanation)).toBeVisible();
  await expect(why.getByText(changed.recovery)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Approve transfer", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Try to execute anyway", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: /INVALID_STATE/ }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Verify recipient (simulated out-of-band check)",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "Check again", exact: true }).click();
  await page.getByRole("button", { name: "Approve transfer", exact: true }).click();
  await page
    .getByRole("button", { name: "Send demo transfer", exact: true })
    .click();
  await expect(page.getByText("✓ Transfer complete", { exact: true })).toBeVisible();
  await page
    .getByRole("button", {
      name: "Check receipt",
      exact: true,
    })
    .click();
  await expect(
    page.getByText(
      "No second transfer was made.",
      { exact: true },
    ),
  ).toBeVisible();
  await checkLayout(page);
});

test("edit invalidates approval; paused controls stop execution; limits save", async ({
  page,
  request,
}) => {
  await page.goto("/transfers");
  await page
    .getByLabel("From", { exact: true })
    .selectOption("acct_alice_checking");
  await page
    .getByLabel("To", { exact: true })
    .selectOption("rcp_alice_savings");
  await page.getByLabel("Amount", { exact: false }).fill("25");
  await page.getByRole("button", { name: "Create transfer proposal" }).click();
  await expect(page).toHaveURL(/id=/);
  await page.getByRole("button", { name: "Approve transfer", exact: true }).click();
  await page.getByRole("button", { name: "Edit amount" }).click();
  await page.getByLabel("New amount in dollars").fill("30");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Approve transfer", exact: true }),
  ).toBeEnabled();
  const actionUrl = page.url();
  await page.getByRole("button", { name: "Approve transfer", exact: true }).click();
  await page.goto("/control");
  await page.getByRole("button", { name: /Pause all execution/ }).click();
  await expect(page.getByRole("button", { name: /Resume/ })).toBeVisible();
  const id = new URL(actionUrl).searchParams.get("id");
  const res = await request.post(`/api/actions/${id}/execute`);
  expect(res.status()).toBe(409);
  await page.getByRole("button", { name: /Resume/ }).click();
  await page.getByLabel("Per-transfer limit").fill("2000");
  await page.getByLabel("Daily limit", { exact: true }).fill("5000");
  await page.getByRole("button", { name: "Save limits" }).click();
  await expect(page.getByText(/Saved/)).toBeVisible();
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Review transfer", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Previously verified ·/)).toHaveCount(0);
});

test("assistant fallback is labeled and demo-user switch clears history", async ({
  page,
}) => {
  await page.goto("/chat");
  await page
    .getByLabel("Message", { exact: true })
    .fill("Which subscriptions went up in price?");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(
    page.getByText("Fallback — model unavailable, deterministic summary", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: /^Demo user:/ }).click();
  await page.getByRole("menuitemradio", { name: "Bob Okafor" }).click();
  await expect(page.getByRole("button", { name: "Demo user: Bob Okafor" })).toBeVisible();
  await expect(
    page.getByText("Fallback — model unavailable, deterministic summary", {
      exact: true,
    }),
  ).toHaveCount(0);
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: /^Good (morning|afternoon|evening), Bob\.$/,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Everyday Checking", { exact: true }),
  ).toHaveCount(0);
});

test("API errors render visibly, unknown accounts stay private, reduced motion", async ({
  page,
  request,
}) => {
  await page.route("**/api/accounts", (r) =>
    r.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "INTERNAL",
          message: "Accounts temporarily unavailable",
        },
      }),
    }),
  );
  await page.goto("/");
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Accounts temporarily unavailable" }),
  ).toBeVisible();
  await page.unroute("**/api/accounts");
  await page.reload();
  await expect(
    page.getByText("Everyday Checking", { exact: true }),
  ).toBeVisible();
  const res = await request.get(
    "/api/transactions?accountId=acct_bob_checking",
  );
  expect(res.status()).toBe(404);
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await page
      .locator(".pill")
      .first()
      .evaluate((el) => getComputedStyle(el).transitionDuration),
  ).toBe("0s");
  await checkLayout(page);
});

test("overview rent scenario opens a real proposal and close returns to the list", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Try rent review", exact: true })
    .click();
  await expect(page).toHaveURL(/transfers\?id=/);
  await expect(
    page.getByRole("button", {
      name: "Verify recipient (simulated out-of-band check)",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Close transfer details", exact: true })
    .click();
  await expect(page).toHaveURL(/\/transfers$/);
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Overview", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Review transfer", exact: true }),
  ).toBeVisible();
});

test("AI monitoring panel runs advisory agents and manages the StreamFlix insight", async ({
  page,
}) => {
  await page.goto("/");
  const panel = page.getByRole("region", { name: "AI monitoring" });
  await expect(
    panel.getByText("Advisory — agents can't approve or move money"),
  ).toBeVisible();
  await expect(panel.getByText(/No open findings/)).toBeVisible();
  await panel
    .getByRole("button", { name: "Run monitoring agents", exact: true })
    .click();
  await expect(
    panel
      .getByRole("status")
      .filter({ hasText: /Processed \d+ jobs? · \d+ succeeded/ }),
  ).toBeVisible();
  const insight = panel.getByRole("article").filter({
    has: page.getByRole("heading", { name: /StreamFlix went up/ }),
  });
  await expect(insight).toBeVisible();
  await expect(insight.getByText("Subscription monitor")).toBeVisible();
  await insight.getByText(/^Evidence \(\d+\)$/).click();
  await expect(
    insight.getByRole("link", { name: /StreamFlix/ }).first(),
  ).toBeVisible();
  // Advisory only: no approve/execute/verify controls anywhere in the panel.
  await expect(
    panel.getByRole("button", { name: /approve|execute|verify/i }),
  ).toHaveCount(0);
  await insight.getByRole("button", { name: "Mark seen", exact: true }).click();
  await expect(
    insight.getByRole("button", { name: "Mark seen", exact: true }),
  ).toHaveCount(0);
  await expect(insight.getByText("Seen", { exact: true })).toBeVisible();
  await insight.getByRole("button", { name: /^Dismiss/ }).click();
  await expect(
    panel.getByRole("heading", { name: /StreamFlix went up/ }),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    page
      .getByRole("region", { name: "AI monitoring" })
      .getByRole("button", { name: "Run monitoring agents" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /StreamFlix went up/ }),
  ).toHaveCount(0);
  await checkLayout(page);

  await page.goto("/control");
  const matrix = page.getByRole("table", { name: "Agent permission matrix" });
  await expect(matrix).toBeVisible();
  const row = matrix.getByRole("row", { name: /Subscription monitor/ });
  await expect(
    row.getByRole("cell", { name: "Transactions", exact: true }),
  ).toBeVisible();
  await expect(row.getByText("No", { exact: true })).toHaveCount(3);
  await expect(matrix.getByText("Yes", { exact: true })).toHaveCount(0);
  await checkLayout(page);
});

test("paper account is labeled, excluded from net worth and read-only", async ({
  page,
  request,
}) => {
  const res = await request.get("/api/accounts");
  const { netWorthCents } = (await res.json()) as { netWorthCents: number };
  const expected = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(netWorthCents / 100);
  await page.goto("/");
  await expect(page.locator(".balance-amount")).toHaveText(expected);
  const paperLink = page.getByRole("link", { name: /Paper Portfolio/ });
  await expect(
    paperLink.getByText("Paper · simulated money, not in net worth"),
  ).toBeVisible();
  await paperLink.click();
  await expect(page).toHaveURL(/accounts\?id=acct_alice_paper/);
  await expect(
    page.getByRole("heading", { name: "Paper Portfolio" }),
  ).toBeVisible();
  // Opening an account shows its full detail page (no list preview region).
  const detail = page.locator("main");
  await expect(
    detail.getByText("Paper · simulated money, not in net worth"),
  ).toBeVisible();
  await expect(
    detail.getByText(
      /Trade it on the Trade page/,
    ),
  ).toBeVisible();
  await expect(
    detail.getByRole("heading", { name: "Holdings", exact: true }),
  ).toBeVisible();
  await expect(
    detail.getByRole("listitem").filter({ hasText: "VOO" }).first(),
  ).toBeVisible();
  await expect(
    detail.getByRole("button", { name: /buy|sell|trade|order/i }),
  ).toHaveCount(0);
  await expect(
    page
      .getByRole("button", { name: /Paper Portfolio/ })
      .getByText("Paper · simulated money, not in net worth"),
  ).toBeVisible();
  await checkLayout(page);
});

test("trade page: propose, hold to approve and execute a paper order", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/trade");
  await expect(page.getByRole("heading", { name: "Trade", exact: true })).toBeVisible();
  await expect(page.getByText("Paper · simulated money, not in net worth").first()).toBeVisible();
  await expect(page.getByText("Simulated prices — not real market data")).toBeVisible();
  await page.getByRole("button", { name: /^VTI/ }).click();
  await page.getByLabel("Amount (USD)").fill("50");
  await page.getByRole("button", { name: "Propose buy" }).click();

  const review = page.getByRole("region", { name: "Order review" });
  await expect(review.getByText("Buy $50.00 of VTI")).toBeVisible();
  await expect(review.getByText("Awaiting your approval")).toBeVisible();
  // A tap is not an approval: it needs a deliberate press and hold.
  const hold = review.getByRole("button", { name: /Hold to approve version 1/ });
  await hold.click();
  await expect(review.getByText("Awaiting your approval")).toBeVisible();
  await hold.scrollIntoViewIfNeeded();
  const box = (await hold.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(1500);
  await page.mouse.up();
  await review.getByRole("button", { name: "Execute paper order" }).click();
  await expect(review.getByText("Executed · simulated fill")).toBeVisible();
  await expect(review.getByText(/Paper money only, not counted in net worth/)).toBeVisible();
  await checkLayout(page);
  expect(errors).toEqual([]);
});
