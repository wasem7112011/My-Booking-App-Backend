const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const { MongoClient, ObjectId } = require("mongodb");
const cors = require("cors");
const bcrypt = require("bcrypt");
require("dotenv").config();

const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_SECRET = process.env.ADMIN_SECRET;

if (!JWT_SECRET) {
  console.warn(
    "تحذير: متغير البيئة JWT_SECRET غير موجود. لازم تحطه في .env قبل النشر (JWT_SECRET=نص عشوائي طويل)."
  );
}

if (!ADMIN_SECRET) {
  console.warn(
    "تحذير: متغير البيئة ADMIN_SECRET غير موجود. إنشاء كهنة جدد هيكون معطّل تمامًا لحد ما تحطه."
  );
}

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

function authenticate(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ success: false, error: "يجب تسجيل الدخول" });
  }

  try {
    req.auth = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ success: false, error: "الجلسة منتهية، سجّل الدخول تاني" });
  }
}

function requireSelfUser(paramName) {
  return (req, res, next) => {
    if (req.auth?.role !== "user" || req.auth.id !== req.params[paramName]) {
      return res.status(403).json({ success: false, error: "غير مصرح لك بهذا الإجراء" });
    }
    next();
  };
}

function requireSelfPriest(paramName) {
  return (req, res, next) => {
    const target = decodeURIComponent(req.params[paramName] || "");
    if (req.auth?.role !== "priest" || req.auth.name !== target) {
      return res.status(403).json({ success: false, error: "غير مصرح لك بهذا الإجراء" });
    }
    next();
  };
}

function requireRole(role) {
  return (req, res, next) => {
    if (req.auth?.role !== role) {
      return res.status(403).json({ success: false, error: "غير مصرح لك بهذا الإجراء" });
    }
    next();
  };
}

function requireAdminSecret(req, res, next) {
  const provided = req.headers["x-admin-secret"];
  if (!ADMIN_SECRET || !provided || provided !== ADMIN_SECRET) {
    return res.status(403).json({ success: false, error: "غير مصرح" });
  }
  next();
}

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) {
    return next(new Error("unauthorized"));
  }
  try {
    socket.data.auth = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    next(new Error("unauthorized"));
  }
});

io.on("connection", (socket) => {
  socket.on("join", (room) => {
    if (!room || typeof room !== "string") return;

    const auth = socket.data.auth;

    if (room.startsWith("user:") && auth?.role === "user" && room === `user:${auth.id}`) {
      socket.join(room);
    } else if (room.startsWith("priest:") && auth?.role === "priest" && room === `priest:${auth.name}`) {
      socket.join(room);
    }
  });

  socket.on("leave", (room) => {
    if (room) socket.leave(room);
  });
});

function notifyPriest(priestName, event, payload) {
  if (!priestName) return;
  io.to(`priest:${priestName}`).emit(event, payload || {});
}

function notifyUser(userId, event, payload) {
  if (!userId) return;
  io.to(`user:${userId.toString()}`).emit(event, payload || {});
}

app.use(cors({
  origin: "*", 
  methods: ["GET", "POST", "PATCH", "DELETE", "PUT"],
  allowedHeaders: ["Content-Type", "Authorization", "x-admin-secret"]
}));

app.use(express.json());

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/booking-app";
const client = new MongoClient(MONGO_URI);

let db;

async function deleteExpiredBookings() {
  const today = new Date().toISOString().split("T")[0];

  const expiredBookingsCount = await db.collection("bookings").countDocuments({
    date: { $lt: today }
  });

  const expiredSlotsCount = await db.collection("priestSlots").countDocuments({
    date: { $lt: today }
  });

  if (expiredBookingsCount === 0 && expiredSlotsCount === 0) return;

  await db.collection("bookings").deleteMany({
    date: { $lt: today }
  });

  await db.collection("priestSlots").deleteMany({
    date: { $lt: today }
  });

  io.emit("cleanup");
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
    }, 1000 * 60 * 5);

    const PORT = process.env.PORT || 5000;
    server.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  } catch (err) {
    console.error("MongoDB connection error:", err);
  }
}

startServer();

app.post("/api/register", async (req, res) => {
  try {
    const {
      fullName,
      birthDate,
      phone,
      password,
      address,
      educationStage,
      churchGroup,
      job,
      church
    } = req.body;

    if (typeof phone !== "string" || typeof password !== "string" || !phone || !password) {
      return res.status(400).json({ success: false, error: "بيانات غير صحيحة" });
    }

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
      password: hashedPassword,
      address: address || "",
      educationStage: educationStage || "",
      churchGroup: churchGroup || "",
      job: job || "",
      church: church || ""
    });

    const token = signToken({ id: result.insertedId.toString(), role: "user" });

    res.json({
      success: true,
      token,
      userId: result.insertedId
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

app.post("/api/create-priest", requireAdminSecret, async (req, res) => {
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

    if (typeof phone !== "string" || typeof password !== "string") {
      return res.status(400).json({ success: false, error: "بيانات غير صحيحة" });
    }

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

    const token = signToken({ id: user._id.toString(), role: "user" });

    res.json({
      success: true,
      token,
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

    if (typeof name !== "string" || typeof password !== "string") {
      return res.status(400).json({ success: false, error: "بيانات غير صحيحة" });
    }

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

    const token = signToken({ name: priest.name, role: "priest" });

    res.json({
      success: true,
      token,
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

app.get("/api/users/:id", authenticate, requireSelfUser("id"), async (req, res) => {
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

app.get("/api/user-bookings/:userId", authenticate, requireSelfUser("userId"), async (req, res) => {
  try {
    const { userId } = req.params;
    const bookingsCollection = db.collection("bookings");
    const bookings = await bookingsCollection.find({ userId: new ObjectId(userId) }).toArray();
    res.json(bookings);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/priest-slots", authenticate, async (req, res) => {
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
        bookedCount: s.bookedCount,
        slotsLeft: s.maxSlots - s.bookedCount
      }));

    res.json(formattedSlots);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/bookings", authenticate, requireRole("user"), async (req, res) => {
  try {
    const userId = req.auth.id;
    const { priestName, date, startTime } = req.body;

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
      startTime,
      status: "pending",
      createdAt: new Date()
    });

    const user = await db.collection("users").findOne({ _id: new ObjectId(userId) });

    notifyPriest(priestName, "bookings-updated");
    notifyPriest(priestName, "new-booking", { fullName: user?.fullName || "شخص", date });

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

app.post("/api/priest-slots", authenticate, requireRole("priest"), async (req, res) => {
  try {
    const priestName = req.auth.name;
    const { date, startTime, slotsLeft } = req.body;

    await db.collection("priestSlots").insertOne({
      priestName,
      date,
      startTime,
      maxSlots: Number(slotsLeft),
      bookedCount: 0,
      createdAt: new Date()
    });

    notifyPriest(priestName, "slots-updated");
    notifyPriest(priestName, "new-slot", { date, startTime });

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

app.get("/api/priest-slots/:priestName", authenticate, requireSelfPriest("priestName"), async (req, res) => {
  try {
    const slots = await db
      .collection("priestSlots")
      .find({ priestName: decodeURIComponent(req.params.priestName) })
      .sort({ date: 1 })
      .toArray();

    const formatted = slots.map(s => ({
      _id: s._id,
      date: s.date,
      startTime: s.startTime,
      maxSlots: s.maxSlots,
      bookedCount: s.bookedCount,
      slotsLeft: s.maxSlots - s.bookedCount
    }));

    res.json(formatted);
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

app.delete("/api/priest-slots/:id", authenticate, requireRole("priest"), async (req, res) => {
  try {
    const slot = await db.collection("priestSlots").findOne({
      _id: new ObjectId(req.params.id)
    });

    if (!slot) {
      return res.status(404).json({ success: false, error: "الموعد غير موجود" });
    }

    if (slot.priestName !== req.auth.name) {
      return res.status(403).json({ success: false, error: "غير مصرح لك بهذا الإجراء" });
    }

    await db.collection("priestSlots").deleteOne({
      _id: new ObjectId(req.params.id)
    });

    notifyPriest(slot.priestName, "slots-updated");

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

app.get("/api/bookings/:priestName", authenticate, requireSelfPriest("priestName"), async (req, res) => {
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

app.get("/api/confessors/:priestName", authenticate, requireSelfPriest("priestName"), async (req, res) => {
  try {
    const priestName = decodeURIComponent(req.params.priestName);

    const confessors = await db
      .collection("confessors")
      .find({ priestName })
      .sort({ fullName: 1 })
      .toArray();

    res.json(confessors);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete("/api/confessors/:id", authenticate, requireRole("priest"), async (req, res) => {
  try {
    const { id } = req.params;

    const confessor = await db.collection("confessors").findOne({
      _id: new ObjectId(id)
    });

    if (!confessor) {
      return res.status(404).json({ success: false, error: "السجل غير موجود" });
    }

    if (confessor.priestName !== req.auth.name) {
      return res.status(403).json({ success: false, error: "غير مصرح لك بهذا الإجراء" });
    }

    await db.collection("confessors").deleteOne({ _id: new ObjectId(id) });

    notifyPriest(confessor.priestName, "confessors-updated");

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.patch("/api/bookings/:id", authenticate, requireRole("priest"), async (req, res) => {
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

    if (booking.priestName !== req.auth.name) {
      return res.status(403).json({ success: false, error: "غير مصرح لك بهذا الإجراء" });
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

      if (slot.bookedCount >= slot.maxSlots) {
        return res.status(400).json({
          success: false,
          error: "اكتمل العدد"
        });
      }

      const queueNumber = slot.bookedCount + 1;

      await bookingsCollection.updateOne(
        {
          _id: new ObjectId(id)
        },
        {
          $set: {
            status: "accepted",
            queueNumber
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

      notifyPriest(booking.priestName, "bookings-updated");
      notifyPriest(booking.priestName, "slots-updated");
      notifyUser(booking.userId, "booking-status", {
        status: "accepted",
        priestName: booking.priestName,
        date: booking.date,
        queueNumber
      });
    } else {
      const wasAccepted = booking.status === "accepted";

      if (wasAccepted) {
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

      notifyPriest(booking.priestName, "bookings-updated");
      if (wasAccepted) {
        notifyPriest(booking.priestName, "slots-updated");
      }
      notifyUser(booking.userId, "booking-status", {
        status: "rejected",
        priestName: booking.priestName,
        date: booking.date
      });
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

app.post("/api/bookings/:id/confession", authenticate, requireRole("priest"), async (req, res) => {
  try {
    const { id } = req.params;
    const { confessed } = req.body;

    const bookingsCollection = db.collection("bookings");
    const usersCollection = db.collection("users");
    const confessorsCollection = db.collection("confessors");

    const booking = await bookingsCollection.findOne({ _id: new ObjectId(id) });

    if (!booking) {
      return res.status(404).json({ success: false, error: "الحجز غير موجود" });
    }

    if (booking.priestName !== req.auth.name) {
      return res.status(403).json({ success: false, error: "غير مصرح لك بهذا الإجراء" });
    }

    if (booking.status !== "accepted") {
      return res.status(400).json({ success: false, error: "هذا الحجز غير مقبول بعد" });
    }

    const user = await usersCollection.findOne({ _id: booking.userId });

    const today = new Date().toISOString().split("T")[0];

    const confessorData = {
      priestName: booking.priestName,
      userId: booking.userId,
      fullName: user?.fullName || "",
      phone: user?.phone || "",
      birthDate: user?.birthDate || "",
      address: user?.address || "",
      educationStage: user?.educationStage || "",
      churchGroup: user?.churchGroup || "",
      job: user?.job || "",
      church: user?.church || "",
      updatedAt: new Date()
    };

    if (confessed) {
      confessorData.lastConfessionDate = today;
    }

    await confessorsCollection.updateOne(
      { priestName: booking.priestName, userId: booking.userId },
      {
        $set: confessorData,
        $setOnInsert: { createdAt: new Date() }
      },
      { upsert: true }
    );

    await bookingsCollection.deleteOne({ _id: new ObjectId(id) });

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
        { _id: acceptedBookings[i]._id },
        { $set: { queueNumber: i + 1 } }
      );
    }

    notifyPriest(booking.priestName, "bookings-updated");
    notifyPriest(booking.priestName, "slots-updated");
    notifyPriest(booking.priestName, "confessors-updated");
    notifyUser(booking.userId, "booking-status", {
      status: "closed",
      priestName: booking.priestName,
      date: booking.date
    });
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});