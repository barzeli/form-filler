import { chromium, type Browser, type Page } from "playwright";

const DATA = {
  name: process.env.NAME || "",
  email: process.env.EMAIL || "",
  phone: process.env.PHONE || "",
  time: process.env.TIME || "",
};

async function connectToChrome() {
  return await chromium.connectOverCDP(
    "http://127.0.0.1:9222",
    {
      timeout: 30000,
    }
  );
}

async function findWhatsAppPage(browser: Browser) {
  for (const ctx of browser.contexts()) {
    for (const page of ctx.pages()) {
      const url = page.url();
      if (url && url.includes("web.whatsapp.com")) return page;
    }
  }
  return null;
}

async function extractWhatsAppLineFromPage(whatsAppPage: Page) {
  if (!whatsAppPage) return null;
  const trySelectors = [
    'div[data-testid="msg-text"]',
    'div.copyable-text span[dir="ltr"]',
    'span[dir="ltr"]',
    "div.message-out span",
    "div.message-in span",
  ];

  for (const sel of trySelectors) {
    try {
      const locator = whatsAppPage.locator(sel);
      const count = await locator.count();
      if (count > 0) {
        const text = await locator.nth(count - 1).innerText();
        if (text && text.trim().length > 0) return text.trim();
      }
    } catch (e) {
      // ignore selector errors
    }
  }
  return null;
}

/**
 * Extract a URL from a text blob. Prefer Google Forms links when present.
 */
function extractUrlFromText(text: string | null): string | null {
  if (!text) return null;
  const urls = text.match(/https?:\/\/[^\s)"']+/g);
  if (!urls || urls.length === 0) return null;
  const formUrl =
    urls.find((u) => u.includes("docs.google.com/forms")) || urls[0];
  return formUrl || null;
}

/**
 * Collect WhatsApp info from an open WhatsApp Web tab in the connected browser.
 * Returns the extracted line and a detected form URL (if any).
 */
/**
 * Continuously polls for the WhatsApp Web tab.
 * Retries every minute if not found.
 */
async function waitForWhatsAppPage(browser: Browser) {
  console.log("Looking for WhatsApp page...");
  let whatsAppPage = null;
  while (!whatsAppPage) {
    whatsAppPage = await findWhatsAppPage(browser);
    if (!whatsAppPage) {
      console.log("WhatsApp page not found. Retrying in 1 minute...");
      await new Promise((resolve) => setTimeout(resolve, 60000));
    }
  }
  console.log("Found WhatsApp page");
  return whatsAppPage;
}

/**
 * Continuously checks the WhatsApp page for a form URL in the latest message.
 * Handles page closure recovery by calling waitForWhatsAppPage again if needed.
 */
async function waitForFormUrlInMessage(browser: Browser, initialwhatsAppPage: Page) {
  let whatsAppPage = initialwhatsAppPage;
  let formUrl: string | null = null;

  while (!formUrl) {
    try {
      if (whatsAppPage.isClosed()) {
        console.log("WhatsApp page was closed. Re-scanning...");
        whatsAppPage = await waitForWhatsAppPage(browser);
      }

      const whatsappLine = await extractWhatsAppLineFromPage(whatsAppPage);
      if (whatsappLine) {
        formUrl = extractUrlFromText(whatsappLine);
      }

      if (!formUrl) {
        console.log(
          "No form URL found in last message. Checking again in 1 minute..."
        );
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    } catch (e) {
      console.error("Error during message check:", e);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
  return formUrl;
}

async function run() {
  const browser = await connectToChrome();

  const whatsAppPage = await waitForWhatsAppPage(browser);
  const formUrl = await waitForFormUrlInMessage(browser, whatsAppPage);

  if (formUrl) {
    console.log("Found form URL in WhatsApp message: ", formUrl);
  } else {
    throw new Error(
      "No form URL provided. Include a URL in the WhatsApp message."
    );
  }

  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(formUrl, { waitUntil: "load" });
  await page.waitForLoadState("domcontentloaded")

  await page.waitForTimeout(10000)

  // Fill text boxes (name, email, phone)
  const textboxes = page.getByRole("textbox");
  try {
    await textboxes.nth(0).fill(DATA.name);
    await textboxes.nth(1).fill(DATA.email);
    await textboxes.nth(2).fill(DATA.phone);
  } catch (err) {
    console.warn(
      "Failed to fill textboxes with role selectors, trying input[type=text] fallback"
    );
    const inputs = page.locator(
      'input[type="text"], input[type="email"], input[type="tel"]'
    );
    if ((await inputs.count()) >= 3) {
      await inputs.nth(0).fill(DATA.name);
      await inputs.nth(1).fill(DATA.email);
      await inputs.nth(2).fill(DATA.phone);
    }
  }

  // Select the requested time option
  const radioByName = page.getByRole("radio", { name: new RegExp(DATA.time) });
  if ((await radioByName.count()) > 0) {
    await radioByName.first().click();
  } else {
    // fallback
    const byText = page.locator(`text=${DATA.time}`);
    if ((await byText.count()) > 0) await byText.first().click();
  }

  await page.screenshot({ path: "screenshots/form.png", fullPage: true });

  // Click the submit button
  // Try finding button by exact or partial text matches using a regex
  const submit = page.getByRole("button", { name: /שליחה|שלח|Submit|Send/i });
  try {
    if ((await submit.count()) > 0) {
      await submit.first().click();
    } else {
      // Fallback: looking for specific class structures common in Google Forms (e.g., 'span' with text)
      const spanSubmit = page.locator('div[role="button"] span').filter({ hasText: /שליחה|שלח|Submit|Send/i });
      if ((await spanSubmit.count()) > 0) {
        await spanSubmit.first().click();
      } else {
        // Last resort: input type submit
        const inputSubmit = page.locator('input[type="submit"]');
        if ((await inputSubmit.count()) > 0) await inputSubmit.first().click();
      }
    }
  } catch (e) {
    console.warn("Could not click submit button:", e);
  }

  await page.waitForLoadState("domcontentloaded")
  await page.screenshot({ path: "screenshots/submission.png", fullPage: true });

  await browser.close();
  console.log("Form submitted (screenshot: screenshots/submission.png)");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
