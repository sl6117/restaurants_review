/**
 * Resolves a restaurant name to a Google place ID, so `config/targets.json`
 * doesn't have to be filled in by hand.
 *
 *   npm run resolve-place-id -- "Dr. DOOOM Lab, Nassau"
 *
 * The place ID is only needed for the health check in src/sources/googlePlaces.ts.
 * Everything else works without it.
 */

const query = process.argv.slice(2).join(" ").trim();
const apiKey = process.env.GOOGLE_MAPS_API_KEY;

if (!query) {
  console.error('Usage: npm run resolve-place-id -- "Restaurant Name, City"');
  process.exit(1);
}
if (!apiKey) {
  console.error("Missing GOOGLE_MAPS_API_KEY in .env");
  process.exit(1);
}

const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Goog-Api-Key": apiKey,
    "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress",
  },
  body: JSON.stringify({ textQuery: query, maxResultCount: 5 }),
  signal: AbortSignal.timeout(15_000),
});

if (!response.ok) {
  // Body is not echoed: Google includes the request URL (and therefore the key)
  // in some error payloads.
  console.error(`Places API returned HTTP ${response.status}.`);
  if (response.status === 403) {
    console.error("403 usually means Places API (New) is not enabled on the project,");
    console.error("or the API key restriction does not include it.");
  }
  process.exit(1);
}

const body = (await response.json()) as {
  places?: { id: string; displayName?: { text: string }; formattedAddress?: string }[];
};

if (!body.places?.length) {
  console.error(`No match for "${query}". Try adding the city or street.`);
  process.exit(1);
}

console.log(`Matches for "${query}":\n`);
for (const place of body.places) {
  console.log(`  ${place.displayName?.text ?? "(no name)"}`);
  console.log(`  ${place.formattedAddress ?? ""}`);
  console.log(`  placeId: ${place.id}\n`);
}
console.log("Paste the right placeId into config/targets.json under google.placeId.");
