# WhiskyCompass publisher

`app.js` is the content publishing script. It fetches both popular products
(Rakuten review-count order) and newly updated products (Rakuten update-time
order), then asks LocalLM for a short, neutral product introduction.

## Setup

1. Register a Rakuten Web Service application and obtain an application ID,
   access key, and Rakuten Affiliate ID.
2. Set the values in `.env.example` as environment variables. `RAKUTEN_REFERRER`
   must be identical to an allowed website registered in Rakuten Web Service. Do not place real
   API credentials in a file served from `public/`.
3. Start LM Studio's local server at `http://localhost:1234` (optional; the
   publisher creates conservative fallback text if it is offline).
4. Run `npm run publish:reviews`.

The generated file is `public/data/whiskies.js`; it is loaded before the
front-end script. If no Rakuten credentials are configured, the site keeps its
hand-curated fallback cards and no generated file is overwritten.

## Amazon

Amazon Product Advertising API 5.0 was deprecated on 2026-05-15. This project
therefore does not call that retired API. Each generated card creates an Amazon
Associate search link using `AMAZON_TAG`. When access to Amazon's current
Creators API is granted, add its official credential and endpoint details to a
server-side adapter in `app.js`; never expose those credentials in `public/`.
