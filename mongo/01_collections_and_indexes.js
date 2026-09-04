// Run after data_generation/mongo_seeder.py
// mongosh ridesync mongo/01_collections_and_indexes.js

const TTL_SECONDS = 7200;

function upsertCollection(name, validator) {
  if (db.getCollectionNames().includes(name)) {
    db.runCommand({ collMod: name, validator: validator, validationAction: "error" });
    print("updated validator: " + name);
  } else {
    db.createCollection(name, { validator: validator, validationAction: "error" });
    print("created collection: " + name);
  }
}

upsertCollection("VehicleMetadata", {
  $jsonSchema: {
    bsonType: "object",
    required: ["vehicle_id", "features", "inspections"],
    properties: {
      vehicle_id: { bsonType: "int" },
      features: { bsonType: "object" },
      inspections: {
        bsonType: "array",
        items: {
          bsonType: "object",
          required: ["inspected_on", "result"],
          properties: {
            inspected_on: { bsonType: "date" },
            centre: { bsonType: "string" },
            odometer_km: { bsonType: ["int", "long", "double"] },
            result: { enum: ["PASS", "FAIL", "CONDITIONAL"] },
            notes: { bsonType: "string" }
          }
        }
      },
      certifications: { bsonType: "array", items: { bsonType: "string" } }
    }
  }
});

upsertCollection("TripReviews", {
  $jsonSchema: {
    bsonType: "object",
    required: ["trip_id", "rider_id", "rating", "feedback_tags", "city", "created_at"],
    properties: {
      trip_id: { bsonType: "int" },
      rider_id: { bsonType: "int" },
      vehicle_id: { bsonType: "int" },
      rating: { bsonType: "int", minimum: 1, maximum: 5 },
      feedback_tags: { bsonType: "array", items: { bsonType: "string" } },
      comment: { bsonType: "string" },
      city: { bsonType: "string" },
      created_at: { bsonType: "date" }
    }
  }
});

upsertCollection("TelemetryPings", {
  $jsonSchema: {
    bsonType: "object",
    required: ["vehicle_id", "location", "is_available", "created_at"],
    properties: {
      vehicle_id: { bsonType: "int" },
      driver_id: { bsonType: "int" },
      location: {
        bsonType: "object",
        required: ["type", "coordinates"],
        properties: {
          type: { enum: ["Point"] },
          coordinates: {
            bsonType: "array",
            minItems: 2,
            maxItems: 2,
            items: [
              { bsonType: "double", minimum: -180, maximum: 180 },
              { bsonType: "double", minimum: -90, maximum: 90 }
            ]
          }
        }
      },
      is_available: { bsonType: "bool" },
      speed_kmph: { bsonType: ["double", "int"] },
      created_at: { bsonType: "date" }
    }
  }
});

db.VehicleMetadata.createIndex(
  { vehicle_id: 1 },
  { unique: true, name: "idx_vehicle_metadata_vehicle_id" }
);

db.TelemetryPings.createIndex(
  { location: "2dsphere" },
  { name: "idx_pings_location_2dsphere" }
);

db.TelemetryPings.createIndex(
  { created_at: 1 },
  { name: "idx_pings_created_at_ttl", expireAfterSeconds: TTL_SECONDS }
);

db.TripReviews.createIndex(
  { city: 1, created_at: -1 },
  { name: "idx_reviews_city_created_at" }
);

print("\n--- indexes ---");
["VehicleMetadata", "TripReviews", "TelemetryPings"].forEach(function (c) {
  print(c + ": " + db.getCollection(c).getIndexes().map(function (i) { return i.name; }).join(", "));
});

print("\n--- counts ---");
["VehicleMetadata", "TripReviews", "TelemetryPings"].forEach(function (c) {
  print(c + ": " + db.getCollection(c).countDocuments({}));
});
