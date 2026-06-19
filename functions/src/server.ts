import * as dotenv from "dotenv";
dotenv.config();

import * as admin from "firebase-admin";
import app from "./app";

if (admin.apps.length === 0) {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    admin.initializeApp({
      credential: admin.credential.cert(
        JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
      ),
    });
  } else {
    // Falls back to GOOGLE_APPLICATION_CREDENTIALS env var
    admin.initializeApp();
  }
}

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => {
  console.log(`mentorship-backend running at http://localhost:${PORT}`);
});
