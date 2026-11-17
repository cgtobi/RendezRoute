import type { Geocoder, Place } from "../../src/application/ports.ts";

/** Answers configured queries; unknown queries find nothing. Records every call. */
export class FakeGeocoder implements Geocoder {
  readonly calls: { query: string; language: string }[] = [];
  /** The exact point each reverse lookup received, with the language. */
  readonly reverseCalls: { lat: number; lng: number; language: string }[] = [];
  /** The exact point each description lookup received, with the language (decision D77). */
  readonly describeCalls: { lat: number; lng: number; language: string }[] = [];
  failing = false;

  /** `reverseAnswers` is keyed by "lat,lng" with 2 decimals, for example "48.11,11.56". */
  constructor(
    private readonly answers: Record<string, Place[]> = {},
    private readonly reverseAnswers: Record<string, string> = {},
    /** Keyed by "lat,lng" with 5 decimals, for example "48.12345,11.56789". */
    private readonly describeAnswers: Record<string, string> = {},
  ) {}

  search(query: string, { language }: { language: string }): Promise<Place[]> {
    this.calls.push({ query, language });
    if (this.failing) return Promise.reject(new Error("unavailable"));
    return Promise.resolve(this.answers[query] ?? []);
  }

  reverse(
    point: { lat: number; lng: number },
    { language }: { language: string },
  ): Promise<string | undefined> {
    this.reverseCalls.push({ lat: point.lat, lng: point.lng, language });
    if (this.failing) return Promise.reject(new Error("unavailable"));
    return Promise.resolve(this.reverseAnswers[`${point.lat.toFixed(2)},${point.lng.toFixed(2)}`]);
  }

  describe(
    point: { lat: number; lng: number },
    { language }: { language: string },
  ): Promise<string | undefined> {
    this.describeCalls.push({ lat: point.lat, lng: point.lng, language });
    if (this.failing) return Promise.reject(new Error("unavailable"));
    return Promise.resolve(this.describeAnswers[`${point.lat.toFixed(5)},${point.lng.toFixed(5)}`]);
  }
}
