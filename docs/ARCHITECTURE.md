# Architecture (free plan)

```
Browser (GitHub Pages: static HTML + ES modules, no build step)
   pages  ->  js/backend.js  ->  js/core (validation + record keeping)
                                   |
                                   v
        Firebase Authentication  +  Realtime Database
        (Email/Password, free)      (rules = the security boundary)
```

There is no server code. The app logic in `js/core/` runs in the visitor's browser and writes directly to the database. A visitor could run different code, so nothing in `js/core/` is trusted for security: **`firebase/database.rules.json` decides what every visitor can read and write**, and Firebase enforces it on its own servers.

`js/core/` talks to the database through six methods (`get`, `set`, `update`, `transaction`, `newId`, `increment`). Live mode passes the Firebase SDK; tests and preview mode pass an in-memory database, so the same logic is what gets tested.

## Sign-in and roles

- Firebase Email/Password sign-in. The mobile number is turned into `MOBILE@login.shaadiwish.app` behind the scenes.
- A signed-in user is an **admin** if their UID is listed under `/admins` (editable only in the Firebase console), or a **couple** if `/users/{uid}/coupleId` exists (writable only by the admin). Any other login has no access.
- The admin creates couple logins from the admin panel using a second, temporary Firebase connection, so the admin stays signed in.

## Database nodes

| Node | Contents | Read | Write |
|---|---|---|---|
| `admins/{uid}` | Admin list | admin, own entry | Firebase console only |
| `users/{uid}` | `coupleId`, `mustChange` | admin, self | admin (`mustChange`: self) |
| `couples/{coupleId}` | Names, mobile, status, slug, profile | couple, admin | admin; couple: profile fields only |
| `slugs/{slug}` | Link name → couple id | anyone (one at a time) | admin |
| `publicProfiles/{coupleId}` | Names, date, photos, UPI ID, `active` | anyone | admin; couple except `active`, `slug` |
| `wishlists/{coupleId}/{itemId}` | Item, `stats`, `reservation`, `state`, `rev` | couple, admin | couple, admin |
| `publicWishlists/{coupleId}/{itemId}` | Public copy of visible items | anyone while active | couple, admin |
| `contributions/…`, `lifafa/…` | Payment records with `history` | couple, admin | couple, admin; **guest: create a pending report only** |
| `utrIndex/{utr}` | Used UTRs | one at a time | create once, never changed |
| `guestReceipts/{token}` | Guest's view of one payment | token holder | guest: create; then couple, admin |
| `conversations/…`, `messages/…` | Threads | couple, admin | couple, admin; guest: start a thread, add messages |
| `guestThreads/{token}` | Guest's copy of one thread | token holder | guest: create, add messages; couple, admin |
| `reservations/{coupleId}/{id}` | Gift requests | couple, admin | couple, admin; guest: create a request |
| `groupGifts/…`, `publicGroupGifts/…` | Group and members | couple, admin / anyone | couple, admin; guest: start an empty group |
| `publicPaymentQr/{coupleId}` | The couple's own UPI QR picture as a small data URL (JPG/PNG/WebP, validated by the rules) | anyone, while the profile is live | that couple, admin |
| `thankYouCards/…`, `coupleStats/…`, `paymentSettings/…` | Cards, totals, UPI | couple, admin | couple, admin |
| `publicFeed/{coupleId}` | Recent contributors, approved messages | anyone while active | couple, admin |
| `publicSettings` | Suggested amounts, limits | anyone | admin |
| `auditLogs/{scope}/{id}` | Activity log | admin | couple or admin, add only |

## Money rules

- A guest can only create a record with status `PENDING_VERIFICATION` and a 12-digit UTR. The rules refuse any other status, any verified amount, and any edit.
- `PENDING_VERIFICATION → VERIFIED | REJECTED`, `REJECTED → VERIFIED` (if the money turns up), `VERIFIED → REFUNDED`. Each change is a compare-and-set transaction, so it is applied once.
- An item's totals change inside a transaction on that item, so simultaneous verifications add up exactly.
- Only verified amounts are public or count towards completion.
- Records are never deleted or rewritten; every change is appended to `history`. Totals can be rebuilt from the records at any time.
- Lifafa has its own totals and never affects the wishlist.

## Gift reservation

Guest asks to gift an item (a conversation). The couple replies with brand and model. The guest taps confirm, which only sends a notice. **The couple** then reserves the item (`DISCUSSING → RESERVED`), inside a transaction, so an item can be reserved for one guest only. When the gift arrives the couple confirms receipt (`RECEIVED`) and the item is completed. The couple can release a reservation at any time.

## Guests without accounts

Starting a payment or a conversation creates a random 192-bit token. The guest's page reads `guestReceipts/{token}` or `guestThreads/{token}`; the rules allow reading one token but never listing them. The guest's browser remembers its own tokens.

## Frontend

- Thin HTML pages, one module each; no framework or bundler.
- Text is always inserted as plain text. Links must start with `https://`.
- QR codes, invitation cards, thank-you cards and the PDF are generated in the browser. The only third-party code is the vendored `qrcode-generator` (MIT). Fonts come from Google Fonts with system fallbacks.
- Phones get a bottom navigation bar and bottom sheets; wider screens get a sidebar and dialogs.
