# form-filler

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

Usage example:

```bash
# install playwright browsers (needed once)
bun run install-browsers

# run the filler (basic)
bun run start
```

If you want to extract a message from an already-open WhatsApp Web tab (requires connecting to an existing Chromium instance):

1. Start Chromium / Chrome with remote debugging enabled (example):

```bash
# on Linux
google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/remote-profile
```

2. Run the filler with extraction enabled. The script will search for an open tab with `web.whatsapp.com`, extract the last message using a few common selectors, and paste it into the first textarea it finds in the form:

```bash
bun run start
```

The script will look for a URL inside the extracted message and, if it finds one, will open that URL. The script prefers Google Forms links (`docs.google.com/forms`) when multiple URLs appear in the message — this lets you "share" a form link in WhatsApp and have the filler follow it automatically.

If the script can't locate WhatsApp or the message, it will log a warning and continue filling other fields.

This project was created using `bun init` in bun v1.3.5. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
