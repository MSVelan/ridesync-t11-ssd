// Workflow 4 - multi-faceted review analytics
// mongosh ridesync mongo/03_workflow4_facet.js
//
// Explain capture:
// W4_EXPLAIN_ONLY=1 mongosh --quiet ridesync --file mongo/03_workflow4_facet.js \
//     > performance/mongo_execution_stats.json

const CITY = "Hyderabad";
const WINDOW_DAYS = 90;
const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

const pipeline = [
  // Sub-pipelines inside $facet cannot use an index, so this leading $match is
  // the only stage that can. It is covered by idx_reviews_city_created_at.
  { $match: { city: CITY, created_at: { $gte: since } } },

  {
    $facet: {
      ratingDistribution: [
        { $group: { _id: "$rating", count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
        { $project: { _id: 0, rating: "$_id", count: 1 } },
      ],

      topFeedbackTags: [
        { $unwind: "$feedback_tags" },
        { $group: { _id: "$feedback_tags", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
        { $project: { _id: 0, tag: "$_id", count: 1 } },
      ],

      overall: [
        {
          $group: {
            _id: null,
            averageRating: { $avg: "$rating" },
            totalReviews: { $sum: 1 },
          },
        },
        {
          $project: {
            _id: 0,
            averageRating: { $round: ["$averageRating", 2] },
            totalReviews: 1,
          },
        },
      ],
    },
  },

  {
    $project: {
      city: { $literal: CITY },
      windowDays: { $literal: WINDOW_DAYS },
      ratingDistribution: 1,
      topFeedbackTags: 1,
      averageRating: {
        $ifNull: [{ $arrayElemAt: ["$overall.averageRating", 0] }, null],
      },
      totalReviews: {
        $ifNull: [{ $arrayElemAt: ["$overall.totalReviews", 0] }, 0],
      },
    },
  },
];
const stats = db.TripReviews.explain("executionStats").aggregate(pipeline);

// Quick console sanity check before digging through the full JSON file. Only
// the leading $match is index-eligible ($facet sub-pipelines run in-memory,
// unindexed), so this cursor stage is the one that actually matters here.
const cursorStage = stats.stages ? stats.stages[0]["$cursor"] : null;
if (cursorStage) {
  const winningPlanStr = JSON.stringify(cursorStage.queryPlanner.winningPlan);
  const scanType =
    winningPlanStr.indexOf("IXSCAN") >= 0 ? "IXSCAN" : "COLLSCAN";
  print(
    "\nplan: " +
      scanType +
      "  docsExamined=" +
      cursorStage.executionStats.totalDocsExamined +
      "  nReturned=" +
      cursorStage.executionStats.nReturned +
      "  collectionTotal=" +
      db.TripReviews.countDocuments({}),
  );
}

const OUTPUT_PATH = "performance/mongo_execution_stats.json"; // relative to repo root — run mongosh from there
let existingStats = {};
try {
  existingStats = JSON.parse(fs.readFileSync(OUTPUT_PATH, "utf8"));
} catch (e) {
  // file doesn't exist yet, or isn't valid JSON — start fresh
}
existingStats.workflow4_facet = stats;
fs.writeFileSync(OUTPUT_PATH, JSON.stringify(existingStats, null, 2));
print("\nWrote Workflow 4 explain(executionStats) to " + OUTPUT_PATH);
