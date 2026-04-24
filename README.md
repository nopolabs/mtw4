# mtw4 — MasterTimeWaster (Option 4: Stripe + Cloudflare Workers)

A static ecommerce site built with Eleventy and deployed to Cloudflare Pages, using Stripe for payment processing and a Cloudflare Worker for the checkout and fulfillment backend. Printful is integrated directly via API for print-on-demand fulfillment. No Shopify.

**Live site:** https://mastertimewaster.com

## Stack

- **Static site generator:** Eleventy (11ty) v3
- **Hosting:** Cloudflare Pages (free tier)
- **Payments:** Stripe (2.9% + 30¢ per transaction, no monthly fee)
- **Backend:** Cloudflare Worker
- **Idempotency:** Cloudflare KV
- **Fulfillment:** Printful API (Manual Order / API store)
- **Certificate rendering & delivery:** [parchment](https://github.com/nopolabs/parchment) Cloudflare Worker
- **Bot protection:** Cloudflare Turnstile (managed challenge widget)
- **Source control:** GitHub (nopolabs/mtw4)

## Monthly cost

| Service | Cost |
|---|---|
| Cloudflare Pages | $0 |
| Cloudflare Workers | $0 (free tier) |
| Cloudflare KV | $0 (free tier) |
| Stripe | 2.9% + 30¢ per transaction |
| Domain | ~$1 amortized |
| **Total fixed cost** | **~$0/month** |

## Project structure

```
mtw4/
├── src/
│   ├── _includes/
│   │   └── layout.njk        # Shared HTML layout (nav, footer, head)
│   ├── _data/
│   │   └── products.json     # Product catalog — edit this to add/change products
│   ├── images/               # Product photos
│   ├── styles.css            # Site styles
│   ├── index.njk             # Home page with product cards and Buy Now links
│   ├── about.njk             # About page
│   ├── contact.njk           # Contact page
│   └── success.njk           # Order confirmation page
├── worker/
│   ├── src/
│   │   └── index.js          # Cloudflare Worker — checkout and webhook handlers
│   ├── wrangler.json         # Worker configuration
│   ├── .dev.vars             # Local secrets (never commit — in .gitignore)
│   └── package.json
├── functions/
│   └── parchment/
│       └── [[path]].ts       # Catch-all Pages Function: Turnstile guard + parchment proxy
├── .eleventy.js              # Eleventy config (input: src/, output: _site/)
├── package.json
└── .gitignore
```

## How it works

1. Customer clicks **Buy Now** on a product
2. Request hits the Worker at `GET /checkout?slug=product-slug`
3. Worker creates a Stripe Checkout Session and redirects customer to Stripe's hosted payment page
4. Customer completes payment on Stripe
5. Stripe fires a `checkout.session.completed` webhook to `POST /webhook`
6. Worker validates the Stripe webhook signature
7. Worker checks Cloudflare KV for idempotency (prevents duplicate orders on webhook retries)
8. Worker creates a Printful order via the Printful API
9. Worker confirms the Printful order (moves from `draft` to `pending` → fulfillment begins)
10. Customer is redirected to `/success`

## Certificate feature

The `/certificate` page lets anyone issue a Master Time Waster certificate to a recipient:

1. Visitor fills in name, achievement (optional), and recipient email
2. **Preview Certificate** fetches `GET /parchment/render?name=...` → proxied to parchment → returns a certificate PNG
3. Visitor completes the Cloudflare Turnstile challenge (unlocks the **Send Certificate** button)
4. **Send Certificate** posts `POST /parchment/issue` with the Turnstile token
5. The `functions/parchment/[[path]].ts` Pages Function intercepts the POST:
   - Verifies the Turnstile token with Cloudflare's `v0/siteverify` API
   - On success, forwards the request to the parchment worker with an API key in the `Authorization` header
6. Parchment renders the certificate and emails it to the recipient via Resend

### Pages Function secrets

Set these once in Cloudflare (not in source):

```bash
npx wrangler pages secret put PARCHMENT_BASE_URL --project-name mtw4
npx wrangler pages secret put PARCHMENT_API_KEY --project-name mtw4
npx wrangler pages secret put TURNSTILE_SECRET_KEY --project-name mtw4
```

| Secret | Value |
|---|---|
| `PARCHMENT_BASE_URL` | `https://parchment-worker-mtw.danrevel.workers.dev` |
| `PARCHMENT_API_KEY` | MTW_KEY (must match `ISSUE_API_KEY` on parchment-worker-mtw) |
| `TURNSTILE_SECRET_KEY` | From Cloudflare Turnstile dashboard for site key `0x4AAAAAADCnX6lgNq7_Lfj5` |

The Turnstile site key `0x4AAAAAADCnX6lgNq7_Lfj5` is configured for `mastertimewaster.com` in the [Cloudflare Turnstile dashboard](https://dash.cloudflare.com/?to=/:account/turnstile).

## Local development

```bash
# Eleventy site
npm install
npm start            # starts dev server at http://localhost:8080

# Worker
cd worker
npm install
npm run dev          # starts Worker at http://localhost:8787
```

### Local secrets

Create `worker/.dev.vars` (never commit this file):

```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
PRINTFUL_API_KEY=...
```

### Local webhook testing

Install the Stripe CLI and run:

```bash
stripe listen --forward-to http://localhost:8787/webhook
```

This forwards Stripe webhook events to your local Worker and outputs the local `STRIPE_WEBHOOK_SECRET` to use in `.dev.vars`.

## Adding or changing products

Edit `src/_data/products.json`. Each product needs:

```json
{
  "name": "Product Name",
  "price": "27.00",
  "slug": "product-slug",
  "image": "/images/product-image.jpg"
}
```

Also update the `PRODUCTS` catalog in `worker/src/index.js`:

```javascript
const PRODUCTS = {
  'product-slug': {
    name: 'Product Name',
    price: 2700,           // in cents
    printful_variant_id: XXXXXXXXXX,
  }
};
```

### Finding Printful variant IDs

```bash
# List products in your Printful API store
curl -H "Authorization: Bearer YOUR_PRINTFUL_API_KEY" \
  "https://api.printful.com/store/products?store_id=YOUR_STORE_ID"

# Get variant ID for a specific product
curl -H "Authorization: Bearer YOUR_PRINTFUL_API_KEY" \
  "https://api.printful.com/store/products/PRODUCT_ID?store_id=YOUR_STORE_ID"
```

Use the `sync_variants[0].id` value as the `printful_variant_id`.

## Deployment

### Eleventy site

Deployment is automatic — push to `main` on GitHub and Cloudflare Pages builds and deploys.

- Build command: `npm run build`
- Build output directory: `_site`

### Cloudflare Worker

```bash
cd worker
npm run deploy
```

Worker is deployed to: `https://mtw4-worker.danrevel.workers.dev`

### Production secrets

Set production secrets in Cloudflare (not in wrangler.json):

```bash
cd worker
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put STRIPE_WEBHOOK_SECRET
npx wrangler secret put PRINTFUL_API_KEY
```

## Printful setup

- Store type: **Manual Order / API** (not Squarespace or Shopify)
- Store ID: 17783389
- Products must be created and synced in this store specifically
- The API token must be scoped to this store with order read/write permissions

## Idempotency

Stripe retries webhooks multiple times on failure. To prevent duplicate Printful orders, each processed Stripe session ID is stored in Cloudflare KV (`ORDERS` namespace). Subsequent webhook retries for the same session are ignored.

KV entries expire after 30 days.

## Going live checklist

- [ ] Enable Stripe confirmation emails in Stripe dashboard
