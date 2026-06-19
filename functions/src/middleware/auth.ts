import { Request, Response, NextFunction } from "express";
import * as admin from "firebase-admin";

export interface AuthedRequest extends Request {
  uid?: string;
  isAdmin?: boolean;
}

export async function requireAuth(
  req: AuthedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const header = req.headers.authorization ?? "";
  const match = header.match(/^Bearer (.+)$/);
  if (!match) {
    res.status(401).json({ error: "Missing Authorization bearer token" });
    return;
  }

  try {
    const decoded = await admin.auth().verifyIdToken(match[1]);
    req.uid = decoded.uid;

    const userDoc = await admin.firestore().collection("users").doc(decoded.uid).get();
    req.isAdmin = userDoc.exists && userDoc.data()?.isAdmin === true;

    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (!req.isAdmin) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}
