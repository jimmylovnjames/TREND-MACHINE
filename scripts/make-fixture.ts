import { writeFileSync } from "node:fs";
import { figurePng } from "../tests/helpers/png";

const out = process.argv[2] ?? "fixture.png";
writeFileSync(out, figurePng());
console.log(`wrote ${out}`);
