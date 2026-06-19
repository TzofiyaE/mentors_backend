import { Router } from "express";
import * as admin from "firebase-admin";
import { requireAuth, requireAdmin, AuthedRequest } from "../middleware/auth";
import { Topic } from "../types";

const router = Router();
const db = () => admin.firestore();

// GET /topics - public list of shared mentorship topics
router.get("/", async (_req, res) => {
  const snap = await db().collection("topics").orderBy("name").get();
  res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
});

// POST /topics - admin only, add a topic to the shared list
router.post("/", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  const { name } = req.body as Partial<Topic>;
  if (!name || typeof name !== "string") {
    res.status(400).json({ error: "name is required" });
    return;
  }

  const ref = await db().collection("topics").add({ name });
  res.status(201).json({ id: ref.id, name });
});

export default router;
