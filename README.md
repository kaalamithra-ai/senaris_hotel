# Hotel Senary's Nest Inn — Static Website

Static, single-page marketing and ordering site for **Hotel Senary's Nest Inn**, Tumakuru. Built with plain HTML, Tailwind (CDN) and vanilla JavaScript. Menu data lives in `data/menu.json` and is rendered dynamically.

## Features

- Responsive landing page with hero, rooms, menu, testimonials, FAQ and contact sections.
- Dynamic menu: 95 dishes loaded from `data/menu.json`, with category tabs, search, veg-only filter and price sorting.
- Cart with quantity steppers, subtotal and order confirmation.
- Room booking calculator (suites / deluxe) with nights, tax and total.
- Contact inquiry form (Web3Forms-ready; falls back to a local success state until an access key is configured).
- WhatsApp and click-to-call floating buttons.
- Embedded Google Map and directions link.
- SEO: canonical, Open Graph, Twitter cards and JSON-LD Hotel schema.
- Lazy-loaded images and deferred menu fetch for performance.

## Project structure

```
.
├── index.html              # Single-page app (HTML + inline CSS/JS)
├── data/
│   └── menu.json           # Single source of truth for the 95 dishes
├── assets/
│   └── images/             # Favicons, manifest, logo
├── .github/workflows/
│   └── pages.yml           # GitHub Pages deployment
└── README.md
```

## Local development

No build step is required. Serve the folder over HTTP so `fetch('data/menu.json')` works (file:// may be blocked by some browsers):

```bash
python -m http.server 8000
# then open http://localhost:8000
```

Or use any static server (e.g. `npx serve .`).

## Menu data

`data/menu.json` is an array of dish objects:

```json
{
  "id": 1,
  "cat": "soups",
  "catLabel": "Soups & Bites",
  "name": "Veg Manchow Soup",
  "desc": "...",
  "price": 119,
  "veg": true,
  "spice": 1,
  "pop": true,
  "img": "https://..."
}
```

Edit this file to add/update dishes; the UI reads it on load.

## Enquiry form setup

The form posts to Web3Forms. To enable real email delivery:

1. Create a free access key at https://web3forms.com
2. Replace `YOUR_WEB3FORMS_ACCESS_KEY` in `index.html` with your key.

Until configured, submissions show a success message locally.

## Deployment

GitHub Pages is configured via `.github/workflows/pages.yml`. Push to `main` (or run the workflow manually) to publish.

## Contact

- Address: Plot No. 4112, A Khata, Shettihalli, Jayanagar Western Extn., Ring Road, Tumakuru — 572102
- Phone: 0816 4065433 / 8123137005
- Email: senarysnestinn@gmail.com