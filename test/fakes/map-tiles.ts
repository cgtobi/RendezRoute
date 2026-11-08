import type { MapTiles } from "../../src/application/ports.ts";

/** Records requested tiles and returns the given image, or nothing when failing. */
export class FakeMapTiles implements MapTiles {
  readonly requested: string[] = [];

  constructor(
    private readonly image: Uint8Array,
    private readonly failing = false,
  ) {}

  tile(z: number, x: number, y: number) {
    this.requested.push(`${z}/${x}/${y}`);
    return Promise.resolve(this.failing ? undefined : this.image);
  }
}
