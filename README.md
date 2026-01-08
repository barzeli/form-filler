# form-filler

Usage example:

```bash
# install dependencies
npm install

# install playwright browsers (needed once)
npm run install-browsers

# run the filler (basic)
npm run start
```

The script will create a new chrome window, go to `web.whatsapp.com`, extract the last message using a few common selectors, and paste it into the first textarea it finds in the form:

The script will look for a URL inside the extracted message and, if it finds one, will open that URL. The script prefers Google Forms links (`docs.google.com/forms`) when multiple URLs appear in the message — this lets you "share" a form link in WhatsApp and have the filler follow it automatically.

If the script can't locate WhatsApp or the message, it will log a warning and continue filling other fields.
