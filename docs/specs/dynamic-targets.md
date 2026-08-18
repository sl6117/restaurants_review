# Spec: Dynamic Targets Resolver

## Goal

- Takes in the input free text, and resolve the target restaurant via Google Places Text Search and (or) Yelp Fusion. Never hallucinate the URL, and append the resolved target to `config/targets.json`.

## Entry Point

`npm run add-restaurant -- "dr dooom lab nassau"`

## Behavior

- input is the free text from the cli. If command was: `npm run add-restaurant -- "dr dooom lab nassau"`, input is `dr dooom lab nassau`
- Use Haiku to parse the input into `{name, location}`. The example above will yield `{dr dooom lab, nassau}`. Every URL and ID comes from an API response.
- Verify if Google Places Text search resolves the real place into placeId + mapsURi
- Verify if Yelp Fusion business search resolves to the Yelp URL.
- Obtain the results and append the resolve target to `config/targets.json`.
- The code lives in `src/resolve/`
- For {GOOGLE_MAPS_API_KEY}, read: `process.env.GOOGLE_MAPS_API_KEY`
- Yelp Fusion key: {YELP_API_KEY} via `process.env.YELP_API_KEY` (Key will be provisioned before live runs; tests use fixtures and must not require it.)
- For calling Haiku, use: {ANTHROPIC_API_KEY} via `process.env.ANTHROPIC_API_KEY`

## Rules

- The LLM never invents URLs.
- If fail to resolve in one of the sources, don't fail, and simply use whats available in the other source.
- If both fail to resolve, return error to the user that search target was not found.
- If there is a duplicate (restaurant was already resolved before) placeId (Empty strings never count as a match) OR there is a duplicate yelp businessUrl, refuse to append, exit non-zero with a message.
- If multiple plausible search results return, take the top result.
- Empty strings mean that the result wasn't found

## Shapes

- Below are example formats of contents in `config/targets.json`.
- `[{
"restaurantName": "Dr. DOOOM Lab",
"google": {
  "mapsUrl": "https://www.google.com/maps/place/DrDooomlab/@24.0181165,-78.4753161,17z",
  "placeId": "ChIJexampleExampleExampleExa"
},
"yelp": {
  "businessUrl": "https://www.yelp.com/biz/dr-doom-canary-2"
}
}, {
"restaurantName": "KFC",
"google": {
  "mapsUrl": "https://www.google.com/maps/place/KFC/@24.0181165,-78.4753161,17z",
  "placeId": "ChIJexampleExampleExampleKfc"
},
"yelp": {
  "businessUrl": ""
}
}, {
"restaurantName": "Burger King",
"google": {
  "mapsUrl": "",
  "placeId": ""
},
"yelp": {
  "businessUrl": "https://www.yelp.com/biz/burgerking-nassau-2"
}
}]`

## Non-goals

- Scraping Yelp.
- No retry queue.

## Acceptance

- `npm test` green, no network.
- `npm run typecheck` clean.
- New fixture(s) for the parser + both API responses, redacted.
