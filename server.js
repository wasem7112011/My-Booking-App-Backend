import express from "express";
import cors from "cors";
import { users, priests, bookings } from "./db.js";
import { ObjectId } from "mongodb";

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

app.post('/api/register', async (req, res) => {
  try {
    const { fullName, birthDate, phone, password } = req.body;
    const existing = await users.findOne({ phone });
    if (existing) return res.status(400).json({ error: "رقم الهاتف مستخدم مسبقاً" });

    const result = await users.insertOne({ fullName, birthDate, phone, password });
    res.json({ success: true, userId: result.insertedId });
  } catch (err) {
    res.status(500).json({ error: "حدث خطأ في الخادم" });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { phone, password } = req.body;
    const user = await users.findOne({ phone, password });
    if (!user) return res.status(400).json({ error: "بيانات الدخول غير صحيحة" });
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ error: "حدث خطأ في الخادم" });
  }
});

app.post('/api/priest-login', async (req, res) => {
  try {
    const { name, password } = req.body;
    const priest = await priests.findOne({ name, password });
    if (!priest) return res.status(400).json({ error: "اسم الكاهن أو كلمة المرور غير صحيحة" });
    res.json({ success: true, priest });
  } catch (err) {
    res.status(500).json({ error: "حدث خطأ في الخادم" });
  }
});

app.get('/api/priest-slots', async (req, res) => {
  try {
    const { priestName } = req.query;
    const maxLimit = 3;
    const todayStr = new Date().toISOString().split("T")[0];

    const predefinedSlots = [
      { date: "2026-07-28" },
      { date: "2026-07-30" },
      { date: "2026-08-02" },
      { date: "2026-08-05" }
    ];

    const activeSlots = predefinedSlots.filter(slot => slot.date >= todayStr);

    const slotsWithAvailability = await Promise.all(
      activeSlots.map(async (slot) => {
        const count = await bookings.countDocuments({
          priestName: priestName,
          date: slot.date,
          status: { $ne: "rejected" }
        });
        return {
          date: slot.date,
          slotsLeft: Math.max(0, maxLimit - count)
        };
      })
    );

    res.json(slotsWithAvailability);
  } catch (err) {
    res.status(500).json({ error: "حدث خطأ" });
  }
});

app.get('/api/user-bookings/:userId', async (req, res) => {
  try {
    const todayStr = new Date().toISOString().split("T")[0];
    
    await bookings.deleteMany({
      userId: req.params.userId,
      date: { $lt: todayStr }
    });

    const list = await bookings.find({ 
      userId: req.params.userId,
      date: { $gte: todayStr }
    }).toArray();

    const enrichedList = await Promise.all(
      list.map(async (b) => {
        let queueNumber = null;
        if (b.status === "accepted") {
          const acceptedOnSameDate = await bookings.find({
            priestName: b.priestName,
            date: b.date,
            status: "accepted"
          }).sort({ _id: 1 }).toArray();

          const index = acceptedOnSameDate.findIndex(item => item._id.toString() === b._id.toString());
          if (index !== -1) {
            queueNumber = index + 1;
          }
        }
        return {
          ...b,
          queueNumber
        };
      })
    );

    res.json(enrichedList);
  } catch (err) {
    res.status(500).json({ error: "حدث خطأ" });
  }
});

app.post('/api/bookings', async (req, res) => {
  try {
    const { userId, priestName, date } = req.body;
    const todayStr = new Date().toISOString().split("T")[0];

    await bookings.deleteMany({
      userId: userId,
      date: { $lt: todayStr }
    });

    const existingSameDateBooking = await bookings.findOne({ 
      userId: userId, 
      priestName: priestName,
      date: date,
      status: { $in: ["pending", "accepted"] }
    });

    if (existingSameDateBooking) {
      return res.status(400).json({ error: "لديك حجز مسبق بالفعل مع هذا الكاهن في نفس اليوم." });
    }

    const maxLimit = 3;
    const currentCount = await bookings.countDocuments({ 
      priestName, 
      date, 
      status: { $ne: "rejected" } 
    });

    if (currentCount >= maxLimit) {
      return res.status(400).json({ error: "عذراً، لقد اكتمل العدد الأقصى للحجوزات في هذا اليوم." });
    }

    await bookings.insertOne({ userId, priestName, date, status: "pending" });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "حدث خطأ" });
  }
});

app.get('/api/bookings/:priestName', async (req, res) => {
  try {
    const priestName = req.params.priestName;
    const todayStr = new Date().toISOString().split("T")[0];

    await bookings.deleteMany({
      date: { $lt: todayStr }
    });

    const list = await bookings.find({ priestName, date: { $gte: todayStr } }).toArray();
    
    const acceptedList = await bookings.find({ priestName, status: "accepted", date: { $gte: todayStr } }).sort({ date: 1, _id: 1 }).toArray();

    const enrichedList = await Promise.all(
      list.map(async (b) => {
        let userDoc = null;
        try {
          userDoc = await users.findOne({ _id: new ObjectId(b.userId) });
        } catch (e) {
          userDoc = await users.findOne({ _id: b.userId });
        }

        let queueNumber = null;
        if (b.status === "accepted") {
          const sameDateAccepted = acceptedList.filter(item => item.date === b.date);
          const index = sameDateAccepted.findIndex(item => item._id.toString() === b._id.toString());
          if (index !== -1) {
            queueNumber = index + 1;
          }
        }

        return {
          ...b,
          queueNumber,
          userProfile: userDoc ? {
            fullName: userDoc.fullName,
            birthDate: userDoc.birthDate,
            phone: userDoc.phone
          } : null
        };
      })
    );

    res.json(enrichedList);
  } catch (err) {
    res.status(500).json({ error: "حدث خطأ" });
  }
});

app.get('/api/priest-users/:priestName', async (req, res) => {
  try {
    const priestName = req.params.priestName;
    const priestBookings = await bookings.find({ priestName }).toArray();
    
    const userIds = [...new Set(priestBookings.map(b => b.userId))];
    
    const objectIds = userIds.map(id => {
      try {
        return new ObjectId(id);
      } catch (e) {
        return id;
      }
    });

    const registeredUsers = await users.find({ 
      $or: [
        { _id: { $in: objectIds } },
        { _id: { $in: userIds } }
      ]
    }).toArray();

    res.json(registeredUsers);
  } catch (err) {
    res.status(500).json({ error: "حدث خطأ" });
  }
});

app.patch('/api/bookings/:id', async (req, res) => {
  try {
    const { status } = req.body;
    const bookingId = new ObjectId(req.params.id);

    if (status === "rejected") {
      await bookings.deleteOne({ _id: bookingId });
    } else {
      await bookings.updateOne({ _id: bookingId }, { $set: { status } });
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "حدث خطأ" });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});