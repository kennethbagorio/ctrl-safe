import { config } from "dotenv";
config({ path: ".env.local" });
import { searchCorpus } from "../lib/vector";

const t = Date.now();
searchCorpus("data privacy risks in generative AI")
  .then((r) => {
    console.log(`${r.length} results in ${Date.now() - t} ms`);
    r.forEach((s) => console.log(`  ${s.section} · p. ${s.page} · score ${s.score}`));
  })
  .catch((e) => console.error("SEARCH FAILED:", e.message));
