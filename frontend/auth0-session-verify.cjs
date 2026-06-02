/* eslint-disable @typescript-eslint/no-require-imports */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE_URL = process.env.AUTH_VERIFY_BASE_URL || "http://localhost:3000";
const META_PATH = path.join(process.cwd(), "api_auth_me_response_meta.txt");
const BODY_PATH = path.join(process.cwd(), "api_auth_me_response_body.json");
const LEGACY_BODY_HTML_PATH = path.join(
  process.cwd(),
  "api_auth_me_response_body.html",
);

function nowIso() {
  return new Date().toISOString();
}

async function maybeFill(page, selectors, value) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.count()) {
      try {
        await locator.fill(value, { timeout: 1500 });
        return true;
      } catch {
        // try next selector
      }
    }
  }
  return false;
}

async function maybeClick(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.count()) {
      try {
        await locator.click({ timeout: 1500 });
        return true;
      } catch {
        // try next selector
      }
    }
  }
  return false;
}

async function main() {
  const runId = Date.now();
  const signupEmail = `chessapp.auth0.verify.${runId}@example.com`;
  const signupPassword = `ChessApp!${String(runId).slice(-8)}Aa1`;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  let finalUrl = "";
  let meResult = null;
  let verificationError = null;

  try {
    await page.goto(`${BASE_URL}/auth/login?screen_hint=signup`, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });

    let completedReturnToApp = false;

    for (let step = 0; step < 14; step += 1) {
      if (page.url().startsWith(BASE_URL)) {
        completedReturnToApp = true;
        break;
      }

      await maybeFill(
        page,
        [
          'input[type="email"]',
          'input[name="email"]',
          'input[name="username"]',
          "input#username",
          "input#email",
        ],
        signupEmail,
      );

      await maybeFill(
        page,
        [
          'input[type="password"]',
          'input[name="password"]',
          "input#password",
          'input[name="new-password"]',
        ],
        signupPassword,
      );

      await maybeClick(page, [
        'button[type="submit"]',
        'button:has-text("Continue")',
        'button:has-text("Sign up")',
        'button:has-text("Create account")',
        'button:has-text("Log in")',
        'button:has-text("Login")',
      ]);

      await page.waitForTimeout(2500);
    }

    finalUrl = page.url();

    if (!completedReturnToApp) {
      throw new Error(`Did not return to app origin. Final URL: ${finalUrl}`);
    }

    meResult = await page.evaluate(async () => {
      const response = await fetch("/api/auth/me", {
        method: "GET",
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      const rawBody = await response.text();
      const contentType = response.headers.get("content-type") || "";

      let parsedJson = null;
      try {
        parsedJson = JSON.parse(rawBody);
      } catch {
        parsedJson = null;
      }

      return {
        at: new Date().toISOString(),
        status: response.status,
        ok: response.ok,
        url: response.url,
        contentType,
        bodyTextLength: rawBody.length,
        bodyTextPreview: rawBody.slice(0, 800),
        bodyJson: parsedJson,
      };
    });
  } catch (error) {
    verificationError = error instanceof Error ? error.message : String(error);
  } finally {
    await browser.close();
  }

  const metaLines = [
    `checked_at=${nowIso()}`,
    `base_url=${BASE_URL}`,
    `signup_email=${signupEmail}`,
    `final_url=${finalUrl || "n/a"}`,
    `status=${meResult ? meResult.status : "n/a"}`,
    `ok=${meResult ? meResult.ok : "false"}`,
    `content_type=${meResult ? meResult.contentType : "n/a"}`,
    `body_length=${meResult ? meResult.bodyTextLength : "0"}`,
    `error=${verificationError || "none"}`,
  ];
  fs.writeFileSync(META_PATH, `${metaLines.join("\n")}\n`, "utf8");

  const bodyPayload = {
    checkedAt: nowIso(),
    baseUrl: BASE_URL,
    finalUrl,
    signupEmail,
    verificationError,
    apiAuthMe: meResult,
  };
  fs.writeFileSync(BODY_PATH, JSON.stringify(bodyPayload, null, 2), "utf8");

  const bodyHtml = meResult?.bodyJson
    ? JSON.stringify(meResult.bodyJson, null, 2)
    : meResult?.bodyTextPreview || "";
  fs.writeFileSync(LEGACY_BODY_HTML_PATH, bodyHtml, "utf8");

  if (verificationError) {
    console.error(verificationError);
    process.exitCode = 1;
    return;
  }

  console.log(`${META_PATH}\n${BODY_PATH}\n${LEGACY_BODY_HTML_PATH}`);
}

main();
