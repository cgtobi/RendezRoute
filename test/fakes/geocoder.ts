import type { Geocoder, Place } from "../../src/application/ports.ts";

/** Answers configured queries; unknown queries find nothing. Records every call. */
export class FakeGeocoder implements Geocoder {
  readonly calls: { query: string; language: string }[] = [];
  failing = false;

  constructor(private readonly answers: Record<string, Place[]> = {}) {}

  search(query: string, { language }: { language: string }): Promise<Place[]> {
    this.calls.push({ query, language });
    if (this.failing) return Promise.reject(new Error("unavailable"));
    return Promise.resolve(this.answers[query] ?? []);
  }
}
