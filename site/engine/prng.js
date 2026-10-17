// Small, fast, seedable PRNG (sfc32, public domain, Chris Doty-Humphrey) for the Poisson input.
// Seed expansion uses splitmix32 so that nearby seeds give unrelated streams.
export class Sfc32 {
  constructor(seed = 1) { this.seed(seed); }
  seed(seed) {
    let s = seed >>> 0;
    const next = () => {
      s = (s + 0x9e3779b9) >>> 0;
      let z = s;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
      return (z ^ (z >>> 16)) >>> 0;
    };
    this.a = next(); this.b = next(); this.c = next(); this.d = 1;
    for (let i = 0; i < 15; i++) this.nextU32();     // warm-up
  }
  nextU32() {
    const t = (((this.a + this.b) >>> 0) + this.d) >>> 0;
    this.d = (this.d + 1) >>> 0;
    this.a = (this.b ^ (this.b >>> 9)) >>> 0;
    this.b = (this.c + (this.c << 3)) >>> 0;
    this.c = (((this.c << 21) | (this.c >>> 11)) + t) >>> 0;
    return t;
  }
  /** Integer threshold such that P(nextU32() < threshold) = p to within 2^-32. */
  static threshold(p) { return Math.min(4294967295, Math.floor(p * 4294967296)); }
}
