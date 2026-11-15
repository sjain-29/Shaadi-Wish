# ShaadiWish · Your Dreams, Their Blessings.

A mobile-first Indian wedding gift wishlist that runs **entirely on free services**: GitHub Pages for the website and Firebase's free Spark plan (Authentication + Realtime Database). No Cloud Functions, no Storage, no billing account, nothing to install.

Couples list what they need or dream of. Guests open a link or scan a QR code and, without logging in, contribute any amount, gift a whole item, team up with friends, chat with the couple, or send a Lifafa. Guests pay by UPI straight to the couple: the page shows the couple's **UPI ID with a Copy button** and the **couple's own payment QR with Save as image**.

## Couple's payment QR (how a couple gets and uploads it)

1. Open GPay, PhonePe or Paytm and find **My QR** or **Receive money** (on Paytm and PhonePe, the QR is under your profile).
2. Take a screenshot and crop it so only the QR is visible.
3. In ShaadiWish go to **Settings → Payment details → Your payment QR**, choose the picture, type your password and save.
4. Guests now see exactly that QR on the payment screen, with **Save QR as image**. To replace it, upload a new one; to remove it, tick **Remove my uploaded QR**.

The free plan has no file storage, so the picture is stored as text inside the database and only downloaded on the payment screen.

## Try it first (preview mode)

Until you paste your Firebase config into `js/app-config.js`, the site runs in **preview mode** with sample data stored only in your browser. Put the files on GitHub Pages (step 6) and open the site, or on a computer with Node.js run `npm run serve` and open `http://localhost:5173`.

Preview logins: couple `9876543210 / demo1234`, admin `9000000000 / admin1234`.

## Setup, step by step (about 15 minutes, all in the browser)

### 1. Put the code on GitHub
Create a **public** repository (free GitHub Pages needs a public one), choose **uploading an existing file**, drag in everything from this folder, and commit.

### 2. Firebase Authentication
1. Open console.firebase.google.com → project **wedding-gift-ca42d**. Stay on the free **Spark** plan.
2. **Build → Authentication → Get started → Sign-in method → Email/Password → Enable → Save.** (Leave "Email link" off.)
3. **Authentication → Settings → Authorized domains → Add domain:** `YOUR-USERNAME.github.io` (and later your own domain).

People sign in with **mobile number + password**. Firebase's free sign-in needs an email address, so the app quietly turns the mobile number into `9876543210@login.shaadiwish.app`. Nobody ever sees or uses that address.

### 3. Database rules
1. **Build → Realtime Database → Rules.**
2. Open `firebase/database.rules.json` from this project, copy everything, paste it over what is there, and click **Publish**.

These rules are the security of the app. Do not leave the database in "test mode".

### 4. Connect the website
1. Firebase console → gear icon → **Project settings → Your apps → Web (`</>`)** → register an app → copy the config values.
2. On GitHub open `js/app-config.js`, click the pencil, paste `apiKey`, `messagingSenderId` and `appId`, and commit.
3. Once you are live, set `allowPreview: false` in the same file.

### 5. Create the admin (you)
1. **Authentication → Users → Add user.** Email: your mobile number followed by `@login.shaadiwish.app`, for example `9000000000@login.shaadiwish.app`. Choose a strong password.
2. Copy the **User UID** shown in the users table.
3. **Realtime Database → Data.** Hover the top row, click **+**, enter key `admins`. Inside it click **+** again: key = the UID you copied, value = `true`. Click **Add**.

Only people listed under `admins` are administrators, and only you can edit that list, from this console.

### 6. Turn on GitHub Pages
Repository → **Settings → Pages → Deploy from a branch → `main` / `(root)` → Save.** Your site appears at `https://YOUR-USERNAME.github.io/REPOSITORY/` over HTTPS.

### 7. Create your first couple
Open `login.html`, sign in with your mobile number and password, go to **Couples → New couple**, and send the couple the details shown. They sign in, set their own password, add their UPI ID and upload their payment QR under **Settings**, and build their wishlist.

### 8. Custom domain (optional)
Repository → **Settings → Pages → Custom domain**. At your registrar add a **CNAME** for `www` to `YOUR-USERNAME.github.io`, and for the bare domain four **A** records: `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`. Tick **Enforce HTTPS**, then add the domain to Firebase **Authorized domains**.

## How payment works

1. The guest picks an amount and enters their name.
2. The page shows the couple's **UPI ID** (Copy) and the **couple's own payment QR** (Save as image). If the couple has not uploaded one, the app draws a QR from their UPI ID, amount and a short reference note. The guest pays in any UPI app: scan it from another phone, or save it and open it from the gallery inside the UPI app.
3. The guest enters the 12-digit **UTR** and submits. The gift shows as **Pending verification**.
4. The couple checks their bank statement and taps **Verify** or **Reject**. Only verified money counts as received or shows publicly.

The same UTR cannot be submitted twice. There are no app-launch buttons and no payment gateway, so there are no fees.

## Which values are public and which are private

| Value | Where | Public? |
|---|---|---|
| `firebaseConfig` (apiKey, projectId, appId) | `js/app-config.js` | **Public by design.** It only names your project. The database rules decide who can do what. |
| Couple's UPI ID and payee name | Database, public profile | Public: guests need it to pay. |
| Couple's uploaded payment QR picture | Database, `publicPaymentQr/{coupleId}` | Public: guests scan or save it. JPG/PNG/WebP only, under about 420 KB (the app shrinks it). Only that couple (or admin) can change it. |
| Passwords | Firebase Authentication | **Private.** Stored hashed by Google; not in the database or the code. |
| The `admins` list | Database | Editable only from the Firebase console. |
| Service-account key files | Not needed | Never download one into this folder. |

## What the free plan cannot do (please read)

- **No spam protection on guest actions.** Without a server there is no rate limiting. Someone could submit fake payment reports or messages. They **cannot** fake verified money, read private data, or change anything that exists; the couple simply rejects fake reports. If abuse ever happens, Firebase App Check (free, reCAPTCHA) is the next step.
- **Payment is verified by hand.** The app cannot see a bank account.
- **No photo uploads.** Item pictures and couple photos are added by pasting an image link (`https://…`). Guests cannot attach screenshots.
- **Forgotten passwords.** The admin cannot set a password directly. Delete the old login in the Firebase console (Authentication → Users), then use **Couples → (couple) → New login**. The couple's data is kept.
- **Maintenance mode** is respected by the app's own pages, but it is not a hard lock.
- **Free limits.** The Spark plan caps simultaneous connections, stored data and monthly download (see firebase.google.com/pricing for current numbers). That is plenty for a handful of weddings; a very large event with hundreds of guests online at the same moment could reach the connection cap.
- Anyone can technically create a Firebase login with your public key, but a login that the admin has not linked to a couple has **no access to anything**.

## Security summary

- Guests can read only the public wishlist, and their own conversation or payment status through a secret 192-bit link.
- Guests can only **add**: a pending payment report, a message in their own thread, a gift request, a group. They cannot edit or delete anything.
- A couple can read and change only its own data, and cannot change its own status, link or login.
- A deactivated couple is locked out at once and its public page goes offline.
- Changing the UPI ID needs the account password again.
- All text is shown as plain text, never as HTML; links must start with `https://`.

## What is in the box

| Path | What it is |
|---|---|
| `js/app-config.js` | **The file you edit:** name, tagline, colours, Firebase config. |
| `firebase/database.rules.json` | The security rules you paste into Firebase. |
| `js/core/` | The app's rules: validation, payment records, reservations, messaging. |
| `js/backend-live.js`, `js/backend-preview.js` | Talk to Firebase, or to sample data in preview mode. |
| `js/public.js`, `contribute.js`, `conversation.js` | Guest pages. |
| `js/dashboard.js`, `dash-money.js`, `dash-social.js` | Couple dashboard. |
| `js/admin.js`, `auth.js`, `cards.js`, `ui.js` | Admin panel, sign-in, invitation and thank-you cards, shared UI. |
| `w/index.html`, `404.html` | Short links: `yoursite/w/?aarav-and-meera`. |
| `tests/` | Automated tests. |

## Testing

Needs Node.js 22 on a computer; not needed to run the site.

```bash
npm install
npm test            # 58 tests: the 25 acceptance scenarios (run twice) + the security rules
npm run test:e2e    # optional browser run-through; needs: npm i -D playwright && npx playwright install chromium
```

The tests run the app logic against an in-memory database and check the rules with an offline evaluator. **They do not connect to your Firebase project**, so after setup do this short check on a phone:

1. As admin, create two couples; each signs in and sets a password.
2. Couple A adds an item and a UPI ID. Open A's public link in a private window.
3. Pay ₹1 for real by scanning the QR, submit the UTR, verify it in the dashboard, and see the item's received amount change.
4. As couple B, confirm you see none of A's items, payments or messages.
5. As a guest, ask to gift an item; reply and reserve it from the dashboard; confirm receipt.
6. Download a QR invitation and a thank-you card; export the contributions CSV.

## Rebranding

Edit `js/app-config.js`: `name`, `tagline`, and `colors` (for example `colors: { coral: '#e91e63', purple: '#283593' }`; names match the variables at the top of `css/style.css`). Replace `assets/icons/favicon.svg`. Leave `loginDomain` unchanged once accounts exist.

## Troubleshooting

| Problem | Likely cause |
|---|---|
| Site still says "Preview mode" | `apiKey` in `js/app-config.js` still starts with `PASTE`. |
| "Incorrect mobile number or password" for the admin | The user's email in Firebase must be exactly `MOBILE@login.shaadiwish.app`. |
| "This login is not linked to an account" | The UID is missing under `admins` (step 5), or the couple was created outside the admin panel. |
| "The database did not allow this change" | Rules not published (step 3), or the couple is deactivated. |
| "The login could not be created" | Email/Password sign-in is not enabled (step 2). |
| "This mobile number already has a login" | Delete that user in Authentication → Users, then try again. |
| Totals look wrong | Dashboard → Settings → **Recalculate totals** rebuilds them from the payment records. |
