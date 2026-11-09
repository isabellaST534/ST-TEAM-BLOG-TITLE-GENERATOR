# Blog Topic Finder (Netlify)

Takes a keyword, pulls real Google autocomplete queries, then asks an AI model for 10 topical-authority topics.
Provider order: Gemini, then Groq, then OpenRouter. If one fails or times out, the next one runs.

## Deploy
1. Push this folder to GitHub and import it in Netlify (or run `npx netlify deploy --prod`).
2. Site settings > Environment variables, add:
   - `GEMINI_API_KEY`
   - `GROQ_API_KEY`
   - `OPENROUTER_API_KEY`
3. Redeploy. Keys stay on the server and are never sent to the browser.

## Optional settings (environment variables)
- `GEMINI_MODEL` (default gemini-2.5-flash), `GROQ_MODEL` (default llama-3.3-70b-versatile)
- `OPENROUTER_MODELS`: comma-separated list tried in order (defaults to two free models)
- `AI_TIMEOUT_MS`: per-provider timeout, default 8000

## Things to know
- Free model names change often. If a provider keeps failing, the page shows the error. Update the model variable to a current free model.
- Only Gemini can use live Google Search (grounding), so its ideas are checked against current top results. Groq and OpenRouter answer from model knowledge plus the autocomplete queries.
- Demand and competition labels are AI estimates, not Ahrefs data.
- Netlify's default function timeout is about 10 seconds. If Gemini is slow and falls back, the chain may exceed it. Check your plan's function timeout setting and raise it if you can.
- Local test: `npm i -g netlify-cli`, put the keys in a `.env` file, run `netlify dev`.
