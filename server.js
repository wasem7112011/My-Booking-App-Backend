const express = require("express");
const { MongoClient, ObjectId } = require("mongodb");
const cors = require("cors");
const bcrypt = require("bcrypt");
require("dotenv").config();

const app = express();

app.use(cors({
  origin: "*", 
  methods: ["GET", "POST", "PATCH", "DELETE", "PUT"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json());

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/booking-app";
const client = new MongoClient(MONGO_URI);

let db;

async function startServer() {
  try {
    await client.connect();
    db = client.db();
    console.log("Connected to MongoDB successfully");

    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  } catch (err) {
    console.error("MongoDB connection error:", err);
  }
}

startServer();

app.get("/api/users/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const usersCollection = db.collection("users");
    const user = await usersCollection.findOne({ _id: new ObjectId(id) });
    if (!user) {
      return res.status(404).json({ success: false, error: "المستخدم غير موجود" });
    }
    res.json({ success: true, user: { id: user._id, fullName: user.fullName } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/register", async (req, res) => {
  try {
    const { fullName, birthDate, phone, password } = req.body;

    const usersCollection = db.collection("users");

    const existingUser = await usersCollection.findOne({ phone });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        error: "رقم الهاتف مستخدم بالفعل"
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await usersCollection.insertOne({
      fullName,
      birthDate,
      phone,
      password: hashedPassword
    });

    res.json({
      success: true,
      userId: result.insertedId
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

app.post("/api/create-priest", async (req, res) => {
  try {
    const { name, password } = req.body;

    if (!name || !password) {
      return res.status(400).json({
        success: false,
        error: "الاسم وكلمة المرور مطلوبان"
      });
    }

    const priestsCollection = db.collection("priests");

    const existingPriest = await priestsCollection.findOne({ name });

    if (existingPriest) {
      return res.status(400).json({
        success: false,
        error: "الكاهن موجود بالفعل"
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await priestsCollection.insertOne({
      name,
      password: hashedPassword
    });

    res.json({
      success: true,
      priestId: result.insertedId
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { phone, password } = req.body;

    const usersCollection = db.collection("users");

    const user = await usersCollection.findOne({ phone });

    if (!user) {
      return res.status(400).json({
        success: false,
        error: "رقم الهاتف أو كلمة المرور غير صحيحة"
      });
    }

    const match = await bcrypt.compare(password, user.password);

    if (!match) {
      return res.status(400).json({
        success: false,
        error: "رقم الهاتف أو كلمة المرور غير صحيحة"
      });
    }

    res.json({
      success: true,
      user: {
        id: user._id,
        fullName: user.fullName
      }
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

app.post("/api/priest-login", async (req, res) => {
  try {
    const { name, password } = req.body;

    const priestsCollection = db.collection("priests");

    const priest = await priestsCollection.findOne({ name });

    if (!priest) {
      return res.status(400).json({
        success: false,
        error: "الكاهن غير موجود"
      });
    }

    const match = await bcrypt.compare(password, priest.password);

    if (!match) {
      return res.status(400).json({
        success: false,
        error: "بيانات دخول الكاهن غير صحيحة"
      });
    }

    res.json({
      success: true,
      priest: {
        id: priest._id,
        name: priest.name
      }
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

app.get("/api/priest-slots", async (req, res) => {
  try {
    const { priestName } = req.query;
    const slotsCollection = db.collection("slots");

    let slots = await slotsCollection.find({ priestName }).toArray();

    if (slots.length === 0) {
      const today = new Date();
      const defaultDates = [];
      for (let i = 1; i <= 7; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() + i);
        defaultDates.push(d.toISOString().split("T")[0]);
      }
      for (let d of defaultDates) {
        await slotsCollection.insertOne({ priestName, date: d, maxSlots: 5, bookedCount: 0 });
      }
      slots = await slotsCollection.find({ priestName }).toArray();
    }

    const formattedSlots = slots
      .map(s => ({
        date: s.date,
        slotsLeft: s.maxSlots - s.bookedCount
      }))
      .filter(s => s.slotsLeft > 0);

    res.json(formattedSlots);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/bookings", async (req, res) => {
  try {
    const { userId, priestName, date } = req.body;

    const slotsCollection = db.collection("slots");
    const bookingsCollection = db.collection("bookings");

    const existingBooking = await bookingsCollection.findOne({
      userId: new ObjectId(userId),
      priestName,
      date,
      status: { $in: ["pending", "accepted"] }
    });

    if (existingBooking) {
      return res.status(400).json({
        success: false,
        error: "لقد قمت بحجز هذا الموعد بالفعل"
      });
    }

    const slot = await slotsCollection.findOne({
      priestName,
      date
    });

    if (!slot) {
      return res.status(404).json({
        success: false,
        error: "الموعد غير موجود"
      });
    }

    if (slot.bookedCount >= slot.maxSlots) {
      return res.status(400).json({
        success: false,
        error: "اكتمل العدد لهذا الموعد"
      });
    }

    const result = await bookingsCollection.insertOne({
      userId: new ObjectId(userId),
      priestName,
      date,
      status: "pending",
      queueNumber: null,
      createdAt: new Date()
    });

    await slotsCollection.updateOne(
      {
        _id: slot._id
      },
      {
        $inc: {
          bookedCount: 1
        }
      }
    );

    res.json({
      success: true,
      bookingId: result.insertedId
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

app.get("/api/user-bookings/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const bookingsCollection = db.collection("bookings");
    const bookings = await bookingsCollection.find({ userId: new ObjectId(userId) }).toArray();
    res.json(bookings);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/bookings/:priestName", async (req, res) => {
  try {
    const priestName = decodeURIComponent(req.params.priestName);
    const bookingsCollection = db.collection("bookings");

    const bookings = await bookingsCollection.aggregate([
      { $match: { priestName } },
      {
        $lookup: {
          from: "users",
          localField: "userId",
          foreignField: "_id",
          as: "userProfile"
        }
      },
      { $unwind: { path: "$userProfile", preserveNullAndEmptyArrays: true } }
    ]).toArray();

    const formatted = bookings.map(b => ({
      _id: b._id,
      userProfile: b.userProfile ? {
        _id: b.userProfile._id,
        fullName: b.userProfile.fullName,
        phone: b.userProfile.phone,
        birthDate: b.userProfile.birthDate
      } : null,
      date: b.date,
      status: b.status,
      queueNumber: b.queueNumber
    }));

    res.json(formatted);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/priest-users/:priestName", async (req, res) => {
  try {
    const priestName = decodeURIComponent(req.params.priestName);
    const bookingsCollection = db.collection("bookings");

    const bookings = await bookingsCollection.aggregate([
      { $match: { priestName, status: "accepted" } },
      {
        $lookup: {
          from: "users",
          localField: "userId",
          foreignField: "_id",
          as: "userProfile"
        }
      },
      { $unwind: "$userProfile" }
    ]).toArray();

    const usersMap = new Map();
    bookings.forEach(b => {
      if (b.userProfile) {
        usersMap.set(b.userProfile._id.toString(), {
          _id: b.userProfile._id,
          fullName: b.userProfile.fullName,
          phone: b.userProfile.phone,
          birthDate: b.userProfile.birthDate
        });
      }
    });

    res.json(Array.from(usersMap.values()));
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.patch("/api/bookings/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const bookingsCollection = db.collection("bookings");
    const slotsCollection = db.collection("slots");

    const booking = await bookingsCollection.findOne({
      _id: new ObjectId(id)
    });

    if (!booking) {
      return res.status(404).json({
        success: false,
        error: "الحجز غير موجود"
      });
    }

    if (booking.status === status) {
      return res.json({
        success: true
      });
    }

    let queueNumber = booking.queueNumber;

    if (status === "accepted") {

      const acceptedCount = await bookingsCollection.countDocuments({
        priestName: booking.priestName,
        date: booking.date,
        status: "accepted"
      });

      queueNumber = acceptedCount + 1;

    }

    if (status === "rejected") {

      if (booking.status !== "rejected") {

        await slotsCollection.updateOne(
          {
            priestName: booking.priestName,
            date: booking.date
          },
          {
            $inc: {
              bookedCount: -1
            }
          }
        );

      }

      if (booking.queueNumber) {

        await bookingsCollection.updateMany(
          {
            priestName: booking.priestName,
            date: booking.date,
            queueNumber: {
              $gt: booking.queueNumber
            }
          },
          {
            $inc: {
              queueNumber: -1
            }
          }
        );

      }

      queueNumber = null;

    }

    await bookingsCollection.updateOne(
      {
        _id: booking._id
      },
      {
        $set: {
          status,
          queueNumber
        }
      }
    );

    const updatedBooking = await bookingsCollection.findOne({
      _id: booking._id
    });

    res.json({
      success: true,
      booking: updatedBooking
    });

  } catch (err) {

    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});