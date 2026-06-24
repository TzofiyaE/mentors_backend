import { Router } from "express";
import * as admin from "firebase-admin";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { MentorshipRequest, RequestStatus } from "../types";
import { sendNewRequestEmail, sendMentorResponseEmail } from "../email";
import { notifyNewRequest, notifyRequestResponse, notifyMenteeReply, notifyMenteeCancel } from "../notifications";
import { addTimelineEvent } from "../timeline";

const router = Router();
const db = () => admin.firestore();

const MENTOR_TRANSITIONS: RequestStatus[] = ["approved", "rejected", "needs_info", "completed"];

const TOPIC_MAX       = 200;
const DESCRIPTION_MAX = 2000;

// POST /requests - a mentee creates a new mentorship request
router.post("/", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const uid = req.uid as string;

    const userDoc = await db().collection("users").doc(uid).get();
    if (!userDoc.exists || userDoc.data()?.role !== "mentee") {
      res.status(403).json({ error: { code: "FORBIDDEN" } });
      return;
    }

    const { mentorId, topic, description } = req.body;
    if (!mentorId || !topic) {
      res.status(400).json({ error: { code: "MISSING_FIELDS" } });
      return;
    }

    if (topic.length > TOPIC_MAX || (description && description.length > DESCRIPTION_MAX)) {
      res.status(400).json({ error: { code: "FIELD_TOO_LONG" } });
      return;
    }

    const mentorDoc = await db().collection("mentorProfiles").doc(mentorId).get();
    if (!mentorDoc.exists) {
      res.status(404).json({ error: { code: "NOT_FOUND" } });
      return;
    }

    if (mentorDoc.data()?.availability === "unavailable") {
      res.status(400).json({ error: { code: "MENTOR_UNAVAILABLE" } });
      return;
    }

    const duplicate = await db().collection("mentorshipRequests")
      .where("menteeId", "==", uid)
      .where("mentorId", "==", mentorId)
      .where("status", "in", ["pending", "approved", "needs_info"])
      .limit(1)
      .get();

    if (!duplicate.empty) {
      res.status(409).json({ error: { code: "DUPLICATE_REQUEST" } });
      return;
    }

    const now = admin.firestore.Timestamp.now();
    const data: MentorshipRequest = {
      menteeId: uid,
      mentorId,
      menteeName: userDoc.data()?.fullName,
      mentorName: mentorDoc.data()?.fullName,
      topic,
      description: description ?? null,
      status: "pending",
      mentorResponse: null,
      menteeReply: null,
      createdAt: now,
      updatedAt: now,
    };

    const ref = await db().collection("mentorshipRequests").add(data);

    addTimelineEvent(ref.id, uid, "mentee", "pending", null, description ?? null)
      .catch((err) => console.error("Failed to add timeline event:", err));

    sendNewRequestEmail(
      mentorDoc.data()?.email,
      mentorDoc.data()?.fullName,
      userDoc.data()?.fullName,
      topic,
      description ?? null,
      ref.id
    ).catch((err) => console.error("Failed to send new-request email:", err));

    notifyNewRequest(mentorId, userDoc.data()?.fullName, topic, ref.id, description ?? null)
      .catch((err) => console.error("Failed to create new-request notification:", err));

    res.status(201).json({ id: ref.id, ...data });
  } catch (err) {
    console.error("POST /requests error:", err);
    res.status(500).json({ error: { code: "INTERNAL_ERROR" } });
  }
});

// GET /requests - list requests where the signed-in user is the mentee or the mentor
router.get("/", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const uid = req.uid as string;

    const [asMentee, asMentor] = await Promise.all([
      db().collection("mentorshipRequests").where("menteeId", "==", uid).get(),
      db().collection("mentorshipRequests").where("mentorId", "==", uid).get(),
    ]);

    let requests = [...asMentee.docs, ...asMentor.docs].map((d) => ({ id: d.id, ...d.data() }));

    // Optional comma-separated status filter: ?status=pending,approved
    if (typeof req.query.status === "string") {
      const allowed = new Set(req.query.status.split(",").map(s => s.trim()));
      requests = requests.filter(r => allowed.has((r as unknown as { status: string }).status));
    }

    res.json(requests);
  } catch (err) {
    console.error("GET /requests error:", err);
    res.status(500).json({ error: { code: "INTERNAL_ERROR" } });
  }
});

// GET /requests/:id/timeline - fetch conversation history for a request
router.get("/:id/timeline", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const uid = req.uid as string;
    const requestDoc = await db().collection("mentorshipRequests").doc(req.params.id).get();
    if (!requestDoc.exists) {
      res.status(404).json({ error: { code: "NOT_FOUND" } });
      return;
    }

    const data = requestDoc.data() as MentorshipRequest;
    if (uid !== data.menteeId && uid !== data.mentorId) {
      res.status(403).json({ error: { code: "FORBIDDEN" } });
      return;
    }

    const snap = await db()
      .collection("mentorshipRequests")
      .doc(req.params.id)
      .collection("timeline")
      .orderBy("createdAt", "asc")
      .get();

    res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  } catch (err) {
    console.error("GET /requests/:id/timeline error:", err);
    res.status(500).json({ error: { code: "INTERNAL_ERROR" } });
  }
});

// PATCH /requests/:id - mentor responds, or mentee resubmits after "needs_info"
router.patch("/:id", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const uid = req.uid as string;
    const ref = db().collection("mentorshipRequests").doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) {
      res.status(404).json({ error: { code: "NOT_FOUND" } });
      return;
    }

    const current = doc.data() as MentorshipRequest;
    const { status, mentorResponse } = req.body as { status?: RequestStatus; mentorResponse?: string };
    const now = admin.firestore.Timestamp.now();

    const isMentor = uid === current.mentorId;
    const isMentee = uid === current.menteeId;

    if (isMentor && status && MENTOR_TRANSITIONS.includes(status)) {
      await ref.update({
        status,
        mentorResponse: mentorResponse ?? null,
        menteeReply: null,  // clear stale reply once mentor has responded
        updatedAt: now,
      });

      addTimelineEvent(req.params.id, uid, "mentor", status, current.status, mentorResponse ?? null)
        .catch((err) => console.error("Failed to add timeline event:", err));

      const menteeUserDoc = await db().collection("users").doc(current.menteeId).get();
      sendMentorResponseEmail(
        menteeUserDoc.data()?.email,
        current.menteeName,
        current.mentorName,
        status,
        mentorResponse ?? null,
        req.params.id
      ).catch((err) => console.error("Failed to send mentor-response email:", err));

      notifyRequestResponse(current.menteeId, current.mentorName, status, req.params.id)
        .catch((err) => console.error("Failed to create request-response notification:", err));

    } else if (isMentee && current.status === "needs_info" && status === "pending") {
      const { menteeReply } = req.body as { menteeReply?: string };
      await ref.update({
        status: "pending",
        menteeReply: menteeReply?.trim() || null,
        updatedAt: now,
      });

      addTimelineEvent(req.params.id, uid, "mentee", "pending", "needs_info", menteeReply?.trim() || null)
        .catch((err) => console.error("Failed to add timeline event:", err));

      notifyMenteeReply(current.mentorId, current.menteeName, current.topic, req.params.id)
        .catch((err) => console.error("Failed to create mentee-reply notification:", err));

    } else if (isMentee && current.status === "pending" && status === "canceled") {
      await ref.update({ status: "canceled", updatedAt: now });

      addTimelineEvent(req.params.id, uid, "mentee", "canceled", "pending", null)
        .catch((err) => console.error("Failed to add timeline event:", err));

      notifyMenteeCancel(current.mentorId, current.menteeName, current.topic, req.params.id)
        .catch((err) => console.error("Failed to create cancel notification:", err));

    } else if (isMentee && current.status === "approved" && status === "completed") {
      await ref.update({ status: "completed", updatedAt: now });

      addTimelineEvent(req.params.id, uid, "mentee", "completed", "approved", null)
        .catch((err) => console.error("Failed to add timeline event:", err));

    } else {
      res.status(403).json({ error: { code: "FORBIDDEN" } });
      return;
    }

    const updated = await ref.get();
    res.json({ id: updated.id, ...updated.data() });
  } catch (err) {
    console.error("PATCH /requests/:id error:", err);
    res.status(500).json({ error: { code: "INTERNAL_ERROR" } });
  }
});

export default router;
