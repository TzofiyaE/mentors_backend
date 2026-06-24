# mentorship-backend

Backend (Firestore + Authentication + Express REST API) for the MAAKAF mentorship
system. Consumed by the מנטורינג pages in
[maakaf_home](https://github.com/Maakaf/maakaf_home) (`/he/mentorship/...`).
`maakaf_home` is a frontend-only client: it never calls Firebase directly, only this API.

> **Status:** DEV only. The API runs locally via `npm run dev` (plain Express on
> `localhost:3000`). Firebase project: `mentorship-backend-bf63b` (Firestore + Auth).

## Stack

- Express API — TypeScript, Node 20 (`functions/src/`)
- Firestore — data storage + security rules (`firestore.rules`)
- Firebase Authentication (email/password) — accounts are created and signed in
  **server-side** via `/auth/register` and `/auth/login`, using the Admin SDK and
  the Identity Toolkit REST API. The frontend never uses the Firebase SDK; it stores
  the returned ID token and sends it as `Authorization: Bearer <token>`.
- Nodemailer via Gmail SMTP — transactional emails (welcome, mentorship requests, password reset)

`functions/src/index.ts` is a dormant Firebase Cloud Functions entry kept for future
use if the project moves to the Firebase Blaze billing plan.

## Data model (Firestore)

```text
users/{uid}
  role: "mentor" | "mentee"
  fullName
  email
  isAdmin
  createdAt

mentorProfiles/{uid}
  userId
  fullName
  email
  currentRole          (optional)
  company              (optional)
  expertise: string[]  (required)
  yearsExperience      (optional)
  availability: "available" | "unavailable"
  linkedIn             (required — displayed on mentor cards)
  calendlyUrl          (required — displayed on mentor cards)
  createdAt
  updatedAt

menteeProfiles/{uid}
  userId
  fullName
  email
  experienceLevel      (optional)
  interests: string[]  (required)
  goals                (optional)
  createdAt
  updatedAt

mentorshipRequests/{id}
  menteeId
  mentorId
  menteeName      # denormalized for the mentor's dashboard
  mentorName      # denormalized for the mentee's dashboard
  topic
  description
  status: "pending" | "approved" | "rejected" | "needs_info" | "completed" | "canceled"
  mentorResponse  # mentor's last message (overwritten on each response)
  menteeReply     # mentee's reply after needs_info (overwritten on resubmit)
  createdAt
  updatedAt

  timeline/{eventId}   # subcollection — full conversation history
    type: "created" | "status_changed"
    authorId
    authorRole: "mentor" | "mentee"
    content           # message text, if any
    fromStatus        # null for the initial "created" event
    toStatus
    createdAt

topics/{id}
  name

notifications/{uid}/items/{notifId}
  type: "new_request" | "request_response"
  title
  body
  read
  requestId    # links to the specific mentorshipRequests doc
  createdAt
```

The required/optional split for `mentorProfiles` and `menteeProfiles` matches the
registration forms at `/he/mentorship/register/` in maakaf_home (mentor: שם מלא,
אימייל, סיסמה, תחומי התמחות required; mentee: שם מלא, אימייל, סיסמה, תחומי עניין
required). The `status` values match the badges shown on the dashboards:

| status | Hebrew badge | Who can set it |
| --- | --- | --- |
| `pending` | בהמתנה | system (on create or mentee resubmit) |
| `approved` | אושרה | mentor |
| `rejected` | נדחתה | mentor (response text required) |
| `needs_info` | דורש פרטים נוספים | mentor (response text required) |
| `completed` | הושלמה | mentor or mentee |
| `canceled` | בוטלה | mentee (only from `pending`) |

`users/{uid}` and the matching `mentorProfiles/{uid}`/`menteeProfiles/{uid}` doc are
created server-side by `POST /auth/register` using the Admin SDK (`role` and
`isAdmin: false` are set by the server, not the client).

## API

All endpoints listen directly on the Express server (no path prefix in dev).
Authenticated endpoints expect `Authorization: Bearer <Firebase ID token>`.

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| POST | `/auth/register` | — | Create account (`role`, `fullName`, `email`, `password`, + role profile fields), write `users/{uid}` + profile doc, and sign in |
| POST | `/auth/login` | — | Sign in with `email`/`password`, returns `idToken`/`refreshToken`/`uid`/`role` |
| POST | `/auth/forgot-password` | — | Send a password reset email via Firebase + Gmail |
| GET | `/auth/verify-status/:uid` | — | Poll whether a user's email has been verified |
| POST | `/auth/resend-verification` | — | Resend the verification email |
| POST | `/auth/refresh` | — | Exchange a refresh token for a new ID token |
| GET | `/topics` | — | List shared mentorship topics |
| POST | `/topics` | admin | Add a topic |
| GET | `/mentors` | — | Public mentor directory. Query: `?topic=`, `?availability=` |
| GET | `/mentors/:id` | — | A single mentor profile |
| PUT | `/mentors/me` | mentor | Create/update the signed-in user's mentor profile |
| GET | `/mentees/me` | mentee | The signed-in user's mentee profile |
| GET | `/mentees/:uid` | mentor/admin/self | A mentee's profile |
| PUT | `/mentees/me` | mentee | Create/update the signed-in user's mentee profile |
| POST | `/requests` | mentee | Create a mentorship request (returns `409 DUPLICATE_REQUEST` if an active request with the same mentor already exists) |
| GET | `/requests` | any | List requests where the caller is the mentee or mentor |
| PATCH | `/requests/:id` | mentor/mentee | Update request status. Mentor: `approved`, `rejected`, `needs_info`, `completed`. Mentee: resubmit (`pending` + optional `menteeReply` after `needs_info`), `canceled` (from `pending`), `completed` (from `approved`) |
| GET | `/requests/:id/timeline` | mentor/mentee | Full chronological event history for a request |
| GET | `/admin/stats` | admin | Counts + status breakdown for the admin dashboard |
| GET | `/notifications` | any | The signed-in user's recent notifications (last 50) |
| PATCH | `/notifications/:id/read` | any | Mark a single notification as read |
| POST | `/notifications/read-all` | any | Mark all notifications as read |

## Local development

### 1. Credentials

Place your Firebase Admin service account key at `functions/serviceAccountKey.json`
(gitignored). Generate it from the Firebase Console → Project settings → Service
accounts → "Generate new private key".

Create `functions/.env` (see `functions/.env.example` for all variables and comments):

```env
GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json
FIREBASE_API_KEY=your-firebase-web-api-key
GMAIL_USER=donotreplymkf@gmail.com
GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx
SITE_URL=http://localhost:1313
```

Alternatively, paste the entire service account JSON inline:

```env
FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
```

`FIREBASE_API_KEY` — Firebase Web API key from Firebase Console → Project settings → General.  
`GMAIL_USER` / `GMAIL_APP_PASSWORD` — Gmail account used as the email sender. Enable 2FA on the account, then generate an App Password at [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords).  
`SITE_URL` — base URL of the frontend. Used in email links. Set to the production domain when deploying.

### 2. Run

```sh
# in mentorship-backend repo root
npm run dev
# → mentorship-backend running at http://localhost:3000
```

First time only: `cd functions && npm install`.

`maakaf_home` must also be running — from the `maakaf_home` repo root, run `hugo server`.

## Email notifications

Handled by `functions/src/email.ts` via Nodemailer + Gmail SMTP. All sends are fire-and-forget — email failures are logged but never block the API response.

| Trigger | Recipient | Subject |
| --- | --- | --- |
| New user registers | The new user | ברוך/ה הבא/ה למערכת המנטורינג של מעקף! |
| Mentee submits a request | The mentor | בקשת מנטורינג חדשה מ-{menteeName} (includes description + deep-link to request) |
| Mentor responds to a request | The mentee | עדכון בקשת המנטורינג שלך — {status} (includes response text + deep-link to request) |
| User requests password reset | The user | איפוס סיסמה — מעקף מנטורינג |

Email CTAs link directly to the specific request card via `#req-{requestId}` anchors on the dashboard pages.

## Firestore rules

Deploy rules independently of the API:

```sh
firebase deploy --only firestore:rules
```

## Firebase Cloud Functions (dormant)

`functions/src/index.ts` exports the same Express app as a Firebase Cloud Function.
To deploy it (requires the Blaze billing plan):

```sh
cd functions
npm run build
firebase deploy --only functions
```
