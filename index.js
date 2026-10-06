require("dotenv").config({ path: ".env.local" });

const express = require("express");
const cors = require("cors");
const path = require("path");
const { MongoClient, ObjectId } = require("mongodb");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

/* ---------------- MongoDB (lazy + cached) ---------------- */

const uri = process.env.MONGODB_URI;
const dbName = process.env.DB_NAME || "hour-booking";

let cachedClient = null;
let cachedDb = null;

async function getCollection() {
  // If we already have a live connection, verify and return
  if (cachedClient && cachedDb) {
    try {
      await cachedDb.command({ ping: 1 });
      return cachedDb.collection("bookings");
    } catch (e) {
      console.log("Connection stale, reconnecting...");
      cachedClient = null;
      cachedDb = null;
    }
  }

  if (!uri) throw new Error("MONGODB_URI is not set");

  const client = new MongoClient(uri, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 30000,
    socketTimeoutMS: 45000,
    connectTimeoutMS: 30000,
  });

  await client.connect();
  const db = client.db(dbName);

  cachedClient = client;
  cachedDb = db;
  console.log("✅ Connected to MongoDB →", dbName);

  return db.collection("bookings");
}

/* ---------------- Routes ---------------- */

// GET
app.get("/api/bookings", async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: "Date required" });

    const collection = await getCollection();
    const list = await collection
      .find({ dateISO: date })
      .sort({ start: 1 })
      .toArray();

    res.json(
      list.map((b) => ({
        id: b._id.toString(),
        start: b.start,
        end: b.end,
        name: b.name,
        dateISO: b.dateISO,
      }))
    );
  } catch (err) {
    console.error("GET error:", err);
    res.status(500).json({ error: "Server error", detail: err.message });
  }
});

// POST
app.post("/api/bookings", async (req, res) => {
  try {
    const { start, end, name, dateISO } = req.body || {};

    if (
      typeof start !== "number" ||
      typeof end !== "number" ||
      typeof name !== "string" ||
      typeof dateISO !== "string"
    ) {
      return res.status(400).json({ error: "Missing or invalid fields" });
    }
    if (end <= start) return res.status(400).json({ error: "End must be after start" });
    if (!name.trim()) return res.status(400).json({ error: "Label is required" });

    const collection = await getCollection();

    const overlap = await collection.findOne({
      dateISO,
      start: { $lt: end },
      end: { $gt: start },
    });
    if (overlap) return res.status(409).json({ error: `Overlaps "${overlap.name}"` });

    const result = await collection.insertOne({
      start,
      end,
      name: name.trim(),
      dateISO,
      createdAt: new Date(),
    });

    res.status(201).json({
      id: result.insertedId.toString(),
      start,
      end,
      name: name.trim(),
      dateISO,
    });
  } catch (err) {
    console.error("POST error:", err);
    res.status(500).json({ error: "Server error", detail: err.message });
  }
});

// DELETE
app.delete("/api/bookings", async (req, res) => {
  try {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: "ID required" });

    let objectId;
    try {
      objectId = new ObjectId(id);
    } catch {
      return res.status(400).json({ error: "Invalid ID format" });
    }

    const collection = await getCollection();
    const result = await collection.deleteOne({ _id: objectId });
    if (result.deletedCount === 0)
      return res.status(404).json({ error: "Booking not found" });

    res.json({ message: "Deleted" });
  } catch (err) {
    console.error("DELETE error:", err);
    res.status(500).json({ error: "Server error", detail: err.message });
  }
});

// Fallback to index.html (needed for static hosting on Vercel)
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

/* ---------------- Export for Vercel ---------------- */

module.exports = app;
module.exports.config = { maxDuration: 60 };