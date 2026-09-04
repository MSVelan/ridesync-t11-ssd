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
        { $project: { _id: 0, rating: "$_id", count: 1 } }
      ],

      topFeedbackTags: [
        { $unwind: "$feedback_tags" },
        { $group: { _id: "$feedback_tags", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
        { $project: { _id: 0, tag: "$_id", count: 1 } }
      ],

      overall: [
        {
          $group: {
            _id: null,
            averageRating: { $avg: "$rating" },
            totalReviews: { $sum: 1 }
          }
        },
        {
          $project: {
            _id: 0,
            averageRating: { $round: ["$averageRating", 2] },
            totalReviews: 1
          }
        }
      ]
    }
  },

  {
    $project: {
      city: { $literal: CITY },
      windowDays: { $literal: WINDOW_DAYS },
      ratingDistribution: 1,
      topFeedbackTags: 1,
      averageRating: { $ifNull: [{ $arrayElemAt: ["$overall.averageRating", 0] }, null] },
      totalReviews: { $ifNull: [{ $arrayElemAt: ["$overall.totalReviews", 0] }, 0] }
    }
  }
];

const explainOnly =
  typeof process !== "undefined" && process.env && process.env.W4_EXPLAIN_ONLY;

if (explainOnly) {
  print(EJSON.stringify(db.TripReviews.explain("executionStats").aggregate(pipeline), null, 2));
} else {
  print("=== Workflow 4: review analytics for " + CITY + " (last " + WINDOW_DAYS + " days) ===");
  printjson(db.TripReviews.aggregate(pipeline).toArray());

  const stats = db.TripReviews.explain("executionStats").aggregate(pipeline);
  const cursor = stats.stages ? stats.stages[0]["$cursor"] : null;

  if (cursor) {
    const plan = JSON.stringify(cursor.queryPlanner.winningPlan);
    const scan = plan.indexOf("IXSCAN") >= 0 ? "IXSCAN" : "COLLSCAN";
    print("\nplan: " + scan +
          "  docsExamined=" + cursor.executionStats.totalDocsExamined +
          "  nReturned=" + cursor.executionStats.nReturned +
          "  collectionTotal=" + db.TripReviews.countDocuments({}));
  }
}
