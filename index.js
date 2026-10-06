require("dotenv").config({ path: ".env.local" });

const express = require("express");
const cors = require("cors");
const path = require("path");
const { MongoClient, ObjectId } = require("mongodb");

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- Middleware ----------
app.use(cors());
app.use(express.json());

// ---------- Serve frontend ----------
app.use(express.static(path.join(__dirname, "public")));

// ---------- MongoDB ----------
const uri = process.env.MONGODB_URI;
const dbName = process.env.DB_NAME || "Book-Your-Hours";

if (!uri) {
    console.error("❌ MONGODB_URI is not set in .env.local");
    process.exit(1);
}

let db;
let collection;

async function connectDB() {
    try {
        const client = new MongoClient(uri, {
            serverSelectionTimeoutMS: 10000,
            autoSelectFamily: false // <-- This line fixes the SSL error
        });
        await client.connect();
        db = client.db(dbName);
        collection = db.collection("bookings");
        console.log(`✅ Connected to MongoDB → ${dbName}`);
    } catch (err) {
        console.error("❌ MongoDB connection failed:", err.message);
        process.exit(1);
    }
}

// ---------- API Routes ----------

// GET /api/bookings?date=YYYY-MM-DD
app.get("/api/bookings", async (req, res) => {
    try {
        const { date } = req.query;
        if (!date) return res.status(400).json({ error: "Date required" });

        const list = await collection.find({ dateISO: date }).sort({ start: 1 }).toArray();

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

// POST /api/bookings
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

        // Overlap check
        const overlap = await collection.findOne({
            dateISO,
            start: { $lt: end },
            end: { $gt: start },
        });
        if (overlap) {
            return res.status(409).json({ error: `Overlaps "${overlap.name}"` });
        }

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

// DELETE /api/bookings?id=...
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

        const result = await collection.deleteOne({ _id: objectId });
        if (result.deletedCount === 0)
            return res.status(404).json({ error: "Booking not found" });

        res.json({ message: "Deleted" });
    } catch (err) {
        console.error("DELETE error:", err);
        res.status(500).json({ error: "Server error", detail: err.message });
    }
});

// ---------- Fallback: send index.html ----------
app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ---------- Start ----------
connectDB();
module.exports = app;