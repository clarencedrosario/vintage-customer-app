import fs from "fs";
const p = "src/convex/matterIntelligence.ts";
let src = fs.readFileSync(p, "utf8");
const from = `      createdById: ac.user._id,
      createdAt: Date.now(),
    });


  },
});`;
const to = `      createdById: ac.user._id,
      createdAt: Date.now(),
      processingStatus: "done",
      processingAttempts: 1,
    });
    return {
      analysisVersion,
      proposedFacts: proposedFacts.length,
      dates: dates.length,
      analysisId,
    };
  },
});`;
const n = src.split(from).length - 1;
if (n !== 1) { console.error("A", n); process.exit(1); }
src = src.replace(from, to);
fs.writeFileSync(p, src);
console.log("TAIL_OK");
