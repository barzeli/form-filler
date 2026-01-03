import { chromium } from "playwright";

const DATA = {
  name: process.env.NAME || "",
  email: process.env.EMAIL || "",
  phone: process.env.PHONE || "",
  time: process.env.TIME || "",
};

async function connectToChrome() {
  const cdp = process.env.CONNECT_CDP;

  // if (!cdp) {
  //   throw new Error("CONNECT_CDP environment variable is not set.");
  // }

  console.log("Connecting to existing Chromium via CDP:", cdp);
  return await chromium.connectOverCDP(
    "ws://127.0.0.1:9222/devtools/browser/cce0c24e-1d0b-4420-9ac0-e8b01e3ba8c5",
    {
      timeout: 10000,
    }
  );
}

async function findWhatsAppPage(browser: any) {
  for (const ctx of browser.contexts()) {
    for (const p of ctx.pages()) {
      try {
        const url = p.url();
        if (url && url.includes("web.whatsapp.com")) return p;
      } catch (e) {
        // ignore
      }
    }
  }
  return null;
}

async function extractWhatsAppLineFromPage(waPage: any) {
  if (!waPage) return null;
  const userSel = process.env.WHATSAPP_SELECTOR;
  const trySelectors = userSel
    ? [userSel]
    : [
        'div[data-testid="msg-text"]',
        'div.copyable-text span[dir="ltr"]',
        'span[dir="ltr"]',
        "div.message-out span",
        "div.message-in span",
      ];

  for (const sel of trySelectors) {
    try {
      const locator = waPage.locator(sel);
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
async function getFormInfoFromWhatsApp(
  browser: any
): Promise<{ whatsappLine: string | null; formUrl: string | null }> {
  const waPage = await findWhatsAppPage(browser);
  if (!waPage) return { whatsappLine: null, formUrl: null };

  console.log("Found WhatsApp page, extracting last message...");
  const whatsappLine = await extractWhatsAppLineFromPage(waPage);
  if (whatsappLine) (DATA as any)["whatsapp"] = whatsappLine;
  const formUrl = extractUrlFromText(whatsappLine);
  return { whatsappLine: whatsappLine, formUrl };
}

async function run() {
  const browser = await connectToChrome();

  // Try to extract the last WhatsApp message from an already-open tab
  const info = await getFormInfoFromWhatsApp(browser);
  if (!info.whatsappLine) {
    console.warn(
      "Could not find an open WhatsApp Web tab in the connected browser or could not extract a message. Start Chrome with --remote-debugging-port and pass CONNECT_CDP."
    );
  } else {
    console.log("Extracted WhatsApp line:", info.whatsappLine);
    if (info.formUrl) {
      console.log("Found form URL in WhatsApp message:", info.formUrl);
    }
  }

  const context = await browser.newContext();
  const page = await context.newPage();

  // Determine which form URL to open: preference order -> URL from WhatsApp message -> env FORM_URL
  const formUrl = info.formUrl || process.env.FORM_URL;
  if (!formUrl) {
    throw new Error(
      "No form URL provided. Set FORM_URL env variable or include a URL in the WhatsApp message."
    );
  }

  await page.goto(formUrl, { waitUntil: "load" });
  // small wait to ensure dynamic elements render
  await page.waitForTimeout(1000);

  // Fill text boxes (name, email, phone) using role= textbox
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

  // Select the requested time option (radio button). Try role=radio by accessible name first.
  const radioByName = page.getByRole("radio", { name: new RegExp(DATA.time) });
  if ((await radioByName.count()) > 0) {
    await radioByName.first().click();
  } else {
    // fallback: click an element that contains the time text
    const byText = page.locator(`text=${DATA.time}`);
    if ((await byText.count()) > 0) await byText.first().click();
  }

  // Click the submit button (שליחה / Submit)
  // const submit = page.getByRole("button", { name: /שליחה|Submit|Send|שלח/i });
  // if ((await submit.count()) > 0) {
  //   await submit.first().click();
  // } else {
  //   const inputSubmit = page.locator('input[type="submit"]');
  //   if ((await inputSubmit.count()) > 0) await inputSubmit.first().click();
  // }

  // Wait a short moment for submission result and capture screenshot
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "submission.png", fullPage: true });

  await browser.close();
  console.log("Form submitted (screenshot: submission.png)");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
