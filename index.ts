import { spawn } from "child_process";
import { chromium, type Page } from "playwright";

const DATA = {
  name: process.env.NAME || "",
  email: process.env.EMAIL || "",
  phone: process.env.PHONE || "",
  time: process.env.TIME || "",
};

function launchChrome() {
  console.log("Launching Chrome...");
  // Launch Chrome with remote debugging and a persistent profile
  const chromeProcess = spawn(
    "/opt/google/chrome/chrome",
    [
      "--remote-debugging-port=9222",
      "--user-data-dir=/tmp/remote-profile-clean",
      "--no-first-run",
      "--no-default-browser-check",
    ],
    {
      detached: true,
      stdio: "ignore",
    }
  );
  chromeProcess.unref();
}

async function connectToChrome() {
  return await chromium.connectOverCDP("http://127.0.0.1:9222", {
    timeout: 30000,
  });
}

function isDateToday(dateStr: string) {
  const today = new Date();
  const currentDay = today.getDate();
  const currentMonth = today.getMonth() + 1;
  const currentYear = today.getFullYear();

  // Normalize separators: remove commas, replace dots/slashes with something common or split by regex
  const parts = dateStr.replace(/,/g, "").split(/[./]/);
  if (parts.length !== 3) return false;

  const firstPart = parseInt(parts[0]!, 10);
  const secondPart = parseInt(parts[1]!, 10);
  const yearPart = parseInt(parts[2]!, 10);

  // Check year (4 digits or 2 digits)
  if (yearPart !== currentYear && yearPart !== currentYear % 100) return false;

  // Check DD/MM or MM/DD match
  const isDMY = firstPart === currentDay && secondPart === currentMonth;
  const isMDY = firstPart === currentMonth && secondPart === currentDay;

  return isDMY || isMDY;
}

async function extractMessageText(whatsAppPage: Page) {
  // We primarily rely on messages with 'data-pre-plain-text' to verify the timestamp
  const messages = whatsAppPage.locator("div[data-pre-plain-text]");
  const count = await messages.count();

  if (count === 0) {
    console.log("No messages with timestamp metadata found.");
    return null;
  }

  // Check the last message
  const lastMsg = messages.nth(count - 1);
  const rawPrePlainText = await lastMsg.getAttribute("data-pre-plain-text");
  // format example: [21:55, 6/1/2026] Name:
  if (rawPrePlainText) {
    const match = rawPrePlainText.match(/\[.*?, (.*?)\]/);
    if (match) {
      const msgDateStr = match[1];
      if (msgDateStr && isDateToday(msgDateStr)) {
        // It's today! Get the text.
        // The text is usually in a child span[dir="ltr"] or just innerText
        const text = await lastMsg.innerText();
        return text.trim();
      } else {
        console.log(`Ignoring message from ${msgDateStr} (not today)`);
        return null; // Stop processing this message
      }
    }
  }

  return null;
}

// Extract a URL from a text blob. Prefer Google Forms links when present.
function extractUrlFromText(text: string | null): string | null {
  if (!text) return null;
  const urls = text.match(/https?:\/\/[^\s)"']+/g);
  if (!urls || urls.length === 0) return null;
  const formUrl =
    urls.find((u) => u.includes("docs.google.com/forms")) || urls[0];
  return formUrl || null;
}

// Continuously checks the WhatsApp page for a form URL in the latest message.
async function waitForFormUrlInMessage(whatsAppPage: Page) {
  while (true) {
    try {
      const messageText = await extractMessageText(whatsAppPage);
      if (messageText) {
        const formUrl = extractUrlFromText(messageText);
        if (formUrl) return formUrl;
        else {
          console.log(
            "No form URL found in last message. Checking again in 5 seconds..."
          );
          await new Promise((resolve) => setTimeout(resolve, 5000));
        }
      } else {
        console.log("No valid message found. Checking again in 5 seconds...");
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    } catch (e) {
      console.error("Error during message check:", e);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

async function fillForm(page: Page) {
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
}

async function submitForm(page: Page) {
  // Click the submit button
  // Try finding button by exact or partial text matches using a regex
  const submit = page.getByRole("button", { name: /שליחה|שלח|Submit|Send/i });
  if ((await submit.count()) > 0) {
    await submit.first().click();
  } else {
    // Fallback: looking for specific class structures common in Google Forms (e.g., 'span' with text)
    const spanSubmit = page
      .locator('div[role="button"] span')
      .filter({ hasText: /שליחה|שלח|Submit|Send/i });
    if ((await spanSubmit.count()) > 0) {
      await spanSubmit.first().click();
    } else {
      // Last resort: input type submit
      const inputSubmit = page.locator('input[type="submit"]');
      if ((await inputSubmit.count()) > 0) await inputSubmit.first().click();
    }
  }
}

async function run() {
  const targetHour = 7;
  const targetMinute = 58;

  const now = new Date();
  let targetTime = new Date(now);
  targetTime.setHours(targetHour, targetMinute, 0, 0);

  // If the target time has already passed today, schedule for tomorrow
  if (now > targetTime) {
    targetTime.setDate(targetTime.getDate() + 1);
  }

  const msUntilTarget = targetTime.getTime() - now.getTime();
  console.log(`Waiting until ${targetTime.toLocaleString()} to start...`);

  if (msUntilTarget > 0) {
    await new Promise((resolve) => setTimeout(resolve, msUntilTarget));
  }

  launchChrome();

  // Wait for Chrome to start
  console.log("Waiting for Chrome to become available...");
  await new Promise((resolve) => setTimeout(resolve, 3000));

  const browser = await connectToChrome();
  const context = browser.contexts()[0]!;
  const whatsAppPage = context.pages()[0]!;
  await whatsAppPage.goto("https://web.whatsapp.com", {
    waitUntil: "domcontentloaded",
  });
  await whatsAppPage.locator("span", { hasText: "קבוצת הפאדל של" }).click();

  const formUrl = await waitForFormUrlInMessage(whatsAppPage);

  if (formUrl) {
    console.log("Found form URL in WhatsApp message: ", formUrl);
  } else {
    throw new Error(
      "No form URL provided. Include a URL in the WhatsApp message."
    );
  }

  const formPage = await context.newPage();
  await formPage.goto(formUrl, { waitUntil: "load" });
  await formPage.waitForLoadState("domcontentloaded");

  await fillForm(formPage);

  await formPage.screenshot({ path: "screenshots/form.png", fullPage: true });

  await submitForm(formPage);

  await formPage.waitForLoadState("domcontentloaded");
  await formPage.screenshot({
    path: "screenshots/submission.png",
    fullPage: true,
  });

  await browser.close();
  console.log("Form submitted (screenshot: screenshots/submission.png)");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
