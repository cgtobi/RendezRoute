import type { TokenService } from "../../src/application/ports.ts";
import { sha256Hex } from "../../src/adapters/out/tokens.ts";

/** Predictable tokens; hashing is real so stored hashes match production behaviour. */
export class FakeTokenService implements TokenService {
  #count = 0;

  generate(): string {
    return `token-${String(++this.#count).padStart(4, "0")}`;
  }

  hash(token: string): string {
    return sha256Hex(token);
  }
}
