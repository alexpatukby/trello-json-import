// Configure your Trello REST API key for client-side API calls.
// Get it from `https://trello.com/app-key`.
// This value is public (it's ok for it to be exposed in the browser).
window.TRELLO_IMPORT_APP_KEY = '01f8434d44ddbc61aebb6099e54287ce';

// Optional: shorten token lifetime. Options: "1hour", "1day", "30days", "never".
// window.TRELLO_IMPORT_TOKEN_EXPIRATION = '1day';

// LemonSqueezy checkout URL for license purchase.
window.TRELLO_IMPORT_CHECKOUT_URL = 'https://apatuk.lemonsqueezy.com/checkout/buy/b3f94d07-9071-4772-ba9a-122ec47c3e2b';

// License price displayed in UI (just for display, actual price is set in LemonSqueezy)
// window.TRELLO_IMPORT_LICENSE_PRICE = '$9';

// License validation API URL (optional)
// Since this repo is hosted on GitHub Pages, you need a separate backend service
// Options:
// 1. Separate Netlify function: 'https://your-function.netlify.app/.netlify/functions/validate-license'
// 2. Vercel function: 'https://your-project.vercel.app/api/validate-license'
// 3. Custom backend: 'https://your-backend.com/validate-license'
// If not set, validation will be format-only (less secure)
// window.TRELLO_IMPORT_VALIDATE_URL = 'https://your-function.netlify.app/.netlify/functions/validate-license';


