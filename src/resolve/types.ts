/**
 * Shapes for the dynamic-targets resolver. Spec: docs/specs/dynamic-targets.md.
 *
 * Empty string always means "this source did not resolve". Every URL and ID in
 * a ResolvedTarget is copied verbatim from an API response — nothing in this
 * module may fabricate one.
 */

export interface ParsedInput {
  name: string;
  location: string;
}

export interface GoogleResolution {
  placeId: string;
  mapsUrl: string;
  displayName: string;
}

export interface YelpResolution {
  businessUrl: string;
  name: string;
}

/** Exactly the entry shape appended to config/targets.json. */
export interface ResolvedTarget {
  restaurantName: string;
  google: { mapsUrl: string; placeId: string };
  yelp: { businessUrl: string };
}

/**
 * The subset of fetch the resolver needs. Tests inject a stub that returns
 * fixture payloads; live code passes the global fetch.
 */
export interface HttpResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}
export type HttpFetch = (url: string, init?: RequestInit) => Promise<HttpResponse>;
