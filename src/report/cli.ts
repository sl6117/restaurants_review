import { resolve } from "node:path";
import { slugifyRestaurantName } from "../normalize.ts";

/** `--month=YYYY-MM`, defaulting to the current UTC month. */
export function resolveMonth(argv: string[], now: Date): string {
  const flag = argv.find((arg) => arg.startsWith("--month="));
  if (!flag) return now.toISOString().slice(0, 7);
  const month = flag.slice("--month=".length);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new Error(`--month must be YYYY-MM, got "${month}"`);
  }
  return month;
}

export function reportPath(
  root: string,
  restaurantName: string,
  month: string,
): string {
  return resolve(root, "reports", slugifyRestaurantName(restaurantName), `${month}.md`);
}
