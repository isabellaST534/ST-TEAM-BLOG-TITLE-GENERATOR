# Blog Topic Finder (Netlify, free AI models only)

Takes a keyword, pulls real Google autocomplete queries, then asks a free AI model for 10 topical-authority topics.
The page tries Token Harbor first, then Gemini, then Groq, then OpenRouter. Each provider is a separate request, so each gets its own Netlify time limit.

## Deploy
1. Push this folder to GitHub and import it in Netlify (or run `npx netlify-cli deploy --prod`).
2. Add environment variables (scopes: Functions, context: Production): `GEMINI_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `TOKENHARBOR_API_KEY`.
3. Redeploy.

## Keeping it free
- Gemini: uses only free-tier models (gemini-3.8-flash, 3.5-flash-lite, 3.1-flash-lite). Create the key in a Google AI Studio project WITHOUT billing enabled, otherwise usage may be charged. Google Search grounding is not used (it can be billed).
- Groq: free plan, rate-limited. Default models: openai/gpt-oss-120b, openai/gpt-oss-20b. If both fail, it looks up what your account can use.
- OpenRouter: the function lists models and keeps only those priced $0 for input and output, so it never picks a paid one. Free models are limited per day, and OpenRouter may require allowing free-model data use in your privacy settings.

## Overrides (optional env vars)
`GEMINI_MODELS`, `GROQ_MODEL`, `OPENROUTER_MODELS` (comma lists, tried in order), `AI_TIMEOUT_MS` (per model, default 6500).

## Notes
- Model availability changes often. The page shows each provider's exact error if all fail.
- Demand and competition labels are AI estimates, not Ahrefs data. Ideas come from model knowledge plus the autocomplete queries; there is no live top-10 check.
- Default Netlify function limit is about 10 seconds, so large "thinking" models may time out and the next provider takes over.

## Token Harbor
- Endpoint: https://tokenharbor.ai/v1 (OpenAI-compatible). Default models: deepseek-v4.1-flash:free, mimo-v2.6-flash:free, th-rudder.
- In the Token Harbor dashboard, enable the free models first. Free models may retain prompts and responses for diagnostics and model improvement.
- Paid models are blocked in code: only ids ending in ":free" (or th-rudder) are allowed, including in `TOKENHARBOR_MODELS`.
- Order is set by the provider list in `index.html` (currently Token Harbor first).
