import { Router } from "express";
import * as admin from "firebase-admin";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { MenteeProfile } from "../types";

const router = Router();
const db = () => admin.firestore();

// GET /mentees/me - the signed-in mentee's own profile
router.get("/me", requireAuth, async (req: AuthedRequest, res) => {
  const doc = await db().collection("menteeProfiles").doc(req.uid as string).get();
  if (!doc.exists) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }
  res.json({ id: doc.id, ...doc.data() });
});

// PUT /mentees/me - create or update the signed-in user's mentee profile
router.put("/me", requireAuth, async (req: AuthedRequest, res) => {
  const uid = req.uid as string;

  const userDoc = await db().collection("users").doc(uid).get();
  if (!userDoc.exists || userDoc.data()?.role !== "mentee") {
    res.status(403).json({ error: "Only mentee accounts can edit a mentee profile" });
    return;
  }

  const { experienceLevel, interests, goals } = req.body;
  if (!Array.isArray(interests) || interests.length === 0) {
    res.status(400).json({ error: "interests is required" });
    return;
  }

  const now = admin.firestore.Timestamp.now();
  const ref = db().collection("menteeProfiles").doc(uid);
  const existing = await ref.get();

  const profile: MenteeProfile = {
    userId: uid,
    fullName: userDoc.data()?.fullName,
    email: userDoc.data()?.email,
    experienceLevel: experienceLevel ?? null,
    interests,
    goals: goals ?? null,
    createdAt: existing.exists ? (existing.data() as MenteeProfile).createdAt : now,
    updatedAt: now,
  };

  await ref.set(profile, { merge: true });
  res.json({ id: uid, ...profile });
});

// GET /mentees/:uid - mentor views a mentee's profile (mentee consented on request submission)
router.get("/:uid", requireAuth, async (req: AuthedRequest, res) => {
  const callerUid = req.uid as string;
  const targetUid = req.params.uid;

  if (!req.isAdmin && callerUid !== targetUid) {
    const snap = await db()
      .collection("mentorshipRequests")
      .where("mentorId", "==", callerUid)
      .where("menteeId", "==", targetUid)
      .limit(1)
      .get();

    if (snap.empty) {
      res.status(403).json({ error: { code: "ACCESS_DENIED" } });
      return;
    }
  }

  const doc = await db().collection("menteeProfiles").doc(targetUid).get();
  if (!doc.exists) {
    res.status(404).json({ error: { code: "NOT_FOUND" } });
    return;
  }

  res.json({ id: doc.id, ...doc.data() });
});

export default router;
