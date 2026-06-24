import * as admin from "firebase-admin";
import { TimelineEvent, RequestStatus } from "./types";

const db = () => admin.firestore();

export async function addTimelineEvent(
  requestId: string,
  authorId: string,
  authorRole: "mentor" | "mentee",
  toStatus: RequestStatus,
  fromStatus: RequestStatus | null = null,
  content: string | null = null
): Promise<void> {
  const event: TimelineEvent = {
    type: fromStatus === null ? "created" : "status_changed",
    authorId,
    authorRole,
    content,
    fromStatus,
    toStatus,
    createdAt: admin.firestore.Timestamp.now(),
  };
  await db()
    .collection("mentorshipRequests")
    .doc(requestId)
    .collection("timeline")
    .add(event);
}
