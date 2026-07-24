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

async function deleteExpiredBookings() {
  const today = new Date().toISOString().split("T")[0];

  await db.collection("bookings").deleteMany({
    date: { $lt: today }
  });

  await db.collection("priestSlots").deleteMany({
    date: { $lt: today }
  });
}

async function startServer() {  
  try {
    await client.connect();
    db = client.db();

    console.log("Connected to MongoDB successfully");

    await deleteExpiredBookings();

    setInterval(async () => {
      try {
        await deleteExpiredBookings();
      } catch (err) {
        console.error(err);
      }
    }, 1000 * 60 * 60);

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

app.post("/api/priest-slots", async (req, res) => {
  try {
    const {
      priestName,
      date,
      startTime,
      slotsLeft
    } = req.body;

    await db.collection("priestSlots").insertOne({
      priestName,
      date,
      startTime,
      maxSlots: Number(slotsLeft),
      bookedCount: 0,
      createdAt: new Date()
    });

    res.json({
      success: true
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
    const slotsCollection = db.collection("priestSlots");

    let slots = await slotsCollection.find({ priestName }).toArray();

    const formattedSlots = slots
      .filter(s => s.bookedCount < s.maxSlots)
      .map(s => ({
        _id: s._id,
        date: s.date,
        startTime: s.startTime,
        maxSlots: s.maxSlots,
        bookedCount: s.bookedCount
      }));

    res.json(formattedSlots);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/bookings", async (req, res) => {
  try {
    const {
      userId,
      priestName,
      date,
      startTime
    } = req.body;

    const slotsCollection = db.collection("priestSlots");
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

    const acceptedCount = await bookingsCollection.countDocuments({
      priestName,
      date,
      status: "accepted"
    });

    if (acceptedCount >= slot.maxSlots) {
      return res.status(400).json({
        success: false,
        error: "اكتمل العدد لهذا الموعد"
      });
    }

    const result = await bookingsCollection.insertOne({
      userId: new ObjectId(userId),
      priestName,
      date,
      startTime,
      status: "pending",
      createdAt: new Date()
    });

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

app.get("/api/priest-slots/:priestName", async (req, res) => {
  try {
    const slots = await db
      .collection("priestSlots")
      .find({ priestName: req.params.priestName })
      .sort({ date: 1 })
      .toArray();

    res.json(slots);
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

app.delete("/api/priest-slots/:id", async (req, res) => {
  try {
    await db.collection("priestSlots").deleteOne({
      _id: new ObjectId(req.params.id)
    });

    res.json({
      success: true
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
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

app.get("/api/priests", async (req, res) => {
  try {
    const priests = await db
      .collection("priests")
      .find({}, { projection: { password: 0 } })
      .toArray();

    res.json(priests);
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

app.patch("/api/bookings/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const bookingsCollection = db.collection("bookings");

    const booking = await bookingsCollection.findOne({
      _id: new ObjectId(id)
    });

    if (!booking) {
      return res.status(404).json({
        success: false,
        error: "الحجز غير موجود"
      });
    }

    if (status === "accepted") {
      if (booking.status === "accepted") {
        return res.status(400).json({
          success: false,
          error: "تم قبول هذا الحجز بالفعل"
        });
      }
      const slot = await db.collection("priestSlots").findOne({
        priestName: booking.priestName,
        date: booking.date
      });

      if (!slot) {
        return res.status(400).json({
          success: false,
          error: "الموعد غير موجود"
        });
      }

      const acceptedCount = await bookingsCollection.countDocuments({
        priestName: booking.priestName,
        date: booking.date,
        status: "accepted"
      });

      if (acceptedCount >= slot.maxSlots) {
        return res.status(400).json({
          success: false,
          error: "اكتمل العدد"
        });
      }

      await bookingsCollection.updateOne(
        {
          _id: new ObjectId(id)
        },
        {
          $set: {
            status: "accepted",
            queueNumber: acceptedCount + 1
          }
        }
      );

      await db.collection("priestSlots").updateOne(
        {
          _id: slot._id
        },
        {
          $inc: {
            bookedCount: 1
          }
        }
      );
    } else {
      if (booking.status === "accepted") {
        await db.collection("priestSlots").updateOne(
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

      await bookingsCollection.deleteOne({
        _id: new ObjectId(id)
      });

      const acceptedBookings = await bookingsCollection
        .find({
          priestName: booking.priestName,
          date: booking.date,
          status: "accepted"
        })
        .sort({ queueNumber: 1 })
        .toArray();

      for (let i = 0; i < acceptedBookings.length; i++) {
        await bookingsCollection.updateOne(
          {
            _id: acceptedBookings[i]._id
          },
          {
            $set: {
              queueNumber: i + 1
            }
          }
        );
      }
    }

    res.json({
      success: true
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});