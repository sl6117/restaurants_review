# Spec: Github Publisher

## Goal

- Prepares the repo to be published, and checks if the repo adequate quality for review based on the context in this file.

## Entry Point

- None

## Deliverables

- `README.md` with an architecture diagram
- LICENSE (Apache-2.0)
- `.env.example` (every env var names and comments, but NO values)
- `.github/workflows/ci.yml` running `npm run typecheck` + `npm test`
- `config/targets.example.json` ships with one fictional entry (array shape after the prep commit)
- generic plist filename/contents, genericized SETUP.md/ HANDOFF.md, fixtures redacted of the restaurant name.

## Rules

- CI must need no secrets and no network.
- `git ls-files` shows no `.env`, no `credentials/`
- No tracked file contains a key, token, phone number, email.
- The agent never pushes code. I do.
- Public remote starts from a single squashed initial commit
- Local history is never rewritten or pushed.

## Shapes

- `{
"restaurantName": "Dr. DOOOM Lab",
"google": {
  "mapsUrl": "https://www.google.com/maps/place/DrDooomlab/@24.0181165,-78.4753161,17z",
  "placeId": ""
},
"yelp": {
  "businessUrl": "https://www.yelp.com/biz/dr-doom-canary-2"
}
}`

## Non-Goals

- No code changes are made to `src/`

## Acceptance

- fresh clone -> `npm ci` -> `npm test` green with no network
- `npm run typecheck` clean
- `ci.yml` runs exactly the two checks above.
