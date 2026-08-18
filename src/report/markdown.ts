import type { Synthesis, SynthesizedClaim } from "./synthesize.ts";

export interface ReportContent {
  restaurantName: string;
  month: string;
  synthesis: Synthesis;
  trajectory: string;
}

function claimLines(claims: SynthesizedClaim[]): string {
  if (claims.length === 0) return "- None this month.";
  return claims
    .map((claim) => `- ${claim.text} [${claim.citations.join(", ")}]`)
    .join("\n");
}

export function renderReport(content: ReportContent): string {
  return [
    `# ${content.restaurantName} — ${content.month}`,
    "",
    "## Pros",
    claimLines(content.synthesis.pros),
    "",
    "## Cons",
    claimLines(content.synthesis.cons),
    "",
    "## Recent Ratings Trajectory",
    `- ${content.trajectory}`,
    "",
  ].join("\n");
}
