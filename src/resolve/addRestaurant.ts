/**
 * Resolves a free-text restaurant query into a real Google Maps / Yelp target
 * and appends it to config/targets.json. Spec: docs/specs/dynamic-targets.md.
 *
 *   npm run add-restaurant -- "dr dooom lab canary"
 *
 * Every URL and ID is copied from an API response; nothing is fabricated.
 */
import { parseRestaurantInput } from "./parseInput.ts";
import { searchGooglePlace } from "./googleTextSearch.ts";
import { searchYelpBusiness } from "./yelpSearch.ts";
import {
  appendTarget,
  buildTarget,
  findDuplicate,
  readTargetsFile,
  TARGETS_PATH,
} from "./targetsFile.ts";

async function main(): Promise<number> {
  const input = process.argv.slice(2).join(" ").trim();
  if (!input) {
    console.error('Usage: npm run add-restaurant -- "restaurant name and city"');
    return 1;
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    console.error("Missing ANTHROPIC_API_KEY — needed to parse the query.");
    return 1;
  }
  const googleKey = process.env.GOOGLE_MAPS_API_KEY;
  const yelpKey = process.env.YELP_API_KEY;
  if (!googleKey) console.warn("  ! GOOGLE_MAPS_API_KEY not set; skipping Google.");
  if (!yelpKey) console.warn("  ! YELP_API_KEY not set; skipping Yelp.");
  if (!googleKey && !yelpKey) {
    console.error("Neither GOOGLE_MAPS_API_KEY nor YELP_API_KEY is set; cannot resolve.");
    return 1;
  }

  const parsed = await parseRestaurantInput(input, anthropicKey);
  console.log(`Parsed query: name="${parsed.name}" location="${parsed.location}"`);

  const [google, yelp] = await Promise.all([
    googleKey
      ? searchGooglePlace(parsed.name, parsed.location, googleKey)
      : Promise.resolve({ placeId: "", mapsUrl: "", displayName: "" }),
    yelpKey
      ? searchYelpBusiness(parsed.name, parsed.location, yelpKey)
      : Promise.resolve({ businessUrl: "", name: "" }),
  ]);

  if (!google.placeId && !yelp.businessUrl) {
    console.error(
      `Search target not found: neither Google Places nor Yelp resolved "${input}".`,
    );
    return 1;
  }

  const target = buildTarget(parsed, google, yelp);
  const existing = await readTargetsFile();
  const duplicate = findDuplicate(existing, target);
  if (duplicate) {
    console.error(`Refusing to append: ${duplicate}.`);
    return 1;
  }

  await appendTarget(TARGETS_PATH, existing, target);
  console.log(`Appended "${target.restaurantName}" to config/targets.json`);
  console.log(`  google.placeId:   ${target.google.placeId || "(not found)"}`);
  console.log(`  google.mapsUrl:   ${target.google.mapsUrl || "(not found)"}`);
  console.log(`  yelp.businessUrl: ${target.yelp.businessUrl || "(not found)"}`);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(`Fatal: ${(error as Error).message}`);
    process.exit(1);
  });
