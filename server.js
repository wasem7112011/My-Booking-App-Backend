const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
require("dotenv").config();

const app = express();

app.use(cors({
  origin: "*", 
  methods: ["GET", "POST", "PATCH", "DELETE", "PUT"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json());

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/booking-app";
mongoose.connect(MONGO_URI)
  .then(() => console.log("Connected to MongoDB successfully"))
  .catch((err) => console.error("MongoDB connection error:", err));

const userSchema = new mongoose.Schema({
  fullName: { type: String, required: true },
  birthDate: { type: String, required: true },
  phone: { type: String, required: true, unique: true },
  password: { type: String, required: true }
});
const User = mongoose.model("User", userSchema);

const priestSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  password: { type: String, required: true }
});
const Priest = mongoose.model("Priest", priestSchema);

const slotSchema = new mongoose.Schema({
  priestName: { type: String, required: true },
  date: { type: String, required: true },
  maxSlots: { type: Number, default: 5 },
  bookedCount: { type: Number, default: 0 }
});
const Slot = mongoose.model("Slot", slotSchema);

const bookingSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  priestName: { type: String, required: true },
  date: { type: String, required: true },
  status: { type: String, enum: ["pending", "accepted", "rejected"], default: "pending" },
  queueNumber: { type: Number, default: null }
});
const Booking = mongoose.model("Booking", bookingSchema);

app.get("/", (req, res) => {
  res.send("Booking App Backend is running successfully!");
});

app.post("/api/register", async (req, res) => {
  try {
    const { fullName, birthDate, phone, password } = req.body;
    const existingUser = await User.findOne({ phone });
    if (existingUser) {
      return res.status(400).json({ success: false, error: "رقم الهاتف مستخدم بالفعل" });
    }

    const newUser = new User({ fullName, birthDate, phone, password });
    await newUser.save();
    res.json({ success: true, userId: newUser._id });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { phone, password } = req.body;
    const user = await User.findOne({ phone, password });
    if (!user) {
      return res.status(400).json({ success: false, error: "رقم الهاتف أو كلمة المرور غير صحيحة" });
    }
    res.json({ success: true, user: { id: user._id, fullName: user.fullName } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/priest-login", async (req, res) => {
  try {
    const { name, password } = req.body;
    let priest = await Priest.findOne({ name });
    
    if (!priest && password === "123") {
      priest = new Priest({ name, password });
      await priest.save();
    }

    if (!priest || priest.password !== password) {
      return res.status(400).json({ success: false, error: "بيانات دخول الكاهن غير صحيحة" });
    }

    res.json({ success: true, priest: { name: priest.name } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/priest-slots", async (req, res) => {
  try {
    const { priestName } = req.query;
    let slots = await Slot.find({ priestName });

    if (slots.length === 0) {
      const defaultDates = ["2026-06-10", "2026-06-12", "2026-06-15", "2026-06-17"];
      for (let d of defaultDates) {
        await Slot.create({ priestName, date: d, maxSlots: 5, bookedCount: 0 });
      }
      slots = await Slot.find({ priestName });
    }

    const formattedSlots = slots.map(s => ({
      date: s.date,
      slotsLeft: s.maxSlots - s.bookedCount
    }));

    res.json(formattedSlots);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/bookings", async (req, res) => {
  try {
    const { userId, priestName, date } = req.body;
    
    const slot = await Slot.findOne({ priestName, date });
    if (!slot || slot.bookedCount >= slot.maxSlots) {
      return res.status(400).json({ success: false, error: "عذراً، هذا الموعد لم يعد متاحاً أو اكتمل العدد" });
    }

    const newBooking = new Booking({
      userId,
      priestName,
      date,
      status: "pending"
    });

    await newBooking.save();
    res.json({ success: true, bookingId: newBooking._id });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/user-bookings/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const bookings = await Booking.find({ userId });
    res.json(bookings);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/bookings/:priestName", async (req, res) => {
  try {
    const priestName = decodeURIComponent(req.params.priestName);
    const bookings = await Booking.find({ priestName }).populate("userId", "fullName phone birthDate");
    
    const formatted = bookings.map(b => ({
      _id: b._id,
      userProfile: b.userId,
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
    const bookings = await Booking.find({ priestName, status: "accepted" }).populate("userId", "fullName phone birthDate");
    
    const usersMap = new Map();
    bookings.forEach(b => {
      if (b.userId) {
        usersMap.set(b.userId._id.toString(), b.userId);
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

    const booking = await Booking.findById(id);
    if (!booking) {
      return res.status(404).json({ success: false, error: "الحجز غير موجود" });
    }

    if (status === "accepted" && booking.status !== "accepted") {
      const acceptedCount = await Booking.countDocuments({
        priestName: booking.priestName,
        date: booking.date,
        status: "accepted"
      });
      booking.queueNumber = acceptedCount + 1;

      await Slot.findOneAndUpdate(
        { priestName: booking.priestName, date: booking.date },
        { $inc: { bookedCount: 1 } }
      );
    }

    booking.status = status;
    await booking.save();

    res.json({ success: true, booking });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});