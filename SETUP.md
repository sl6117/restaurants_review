# Setup

Everything in the repo is built and tested. These are the parts only you can do,
because they need your Google account. Roughly 15 minutes.

The destination is a **Google Doc**, with each review's screenshot embedded
inline. Two consequences worth understanding before you start:

- **Auth is OAuth-as-you, not a service account.** The Docs API can't accept
  image bytes — it fetches images from a public URL — so each screenshot must be
  uploaded to *your* Drive first, and service accounts have no Drive storage
  quota of their own.
- **The script creates the doc, you don't.** It requests only the `drive.file`
  scope, which covers just the files it creates. That is deliberate: the
  alternative (`documents`) means "see, edit, create and delete *all* your
  Google Docs", which Google classifies as sensitive — forcing app verification
  and an "unverified app" warning. One narrow scope avoids all of that and means
  this tool can never touch any other document you own.

## 1. Google Cloud (one console session)

Go to <https://console.cloud.google.com>.

1. **New project** — name it anything, e.g. `restaurant-reviews`.
2. **APIs & Services → Library** → enable all three:
   - **Google Docs API**
   - **Google Drive API**
   - **Places API (New)**
3. **Credentials → Create credentials → API key.** Restrict it to Places API
   (New). It goes in `.env` as `GOOGLE_MAPS_API_KEY`.
4. **Credentials → Create credentials → OAuth client ID → Desktop app.**
   Download the JSON, save it as `credentials/oauth-client.json`.

Billing must be enabled for Places API. Expected cost is about **$0.60/month** —
one lightweight call per day. Docs and Drive are free at this volume.

## 2. Publish the OAuth consent screen — do not skip this

**APIs & Services → OAuth consent screen.** Fill in the required fields, add the
one scope below, then click **Publish app**.

```
https://www.googleapis.com/auth/drive.file
```

That is the only scope this app requests. It is **not** a sensitive scope, so
publishing needs no verification review and users see no warning screen. If you
previously added `https://www.googleapis.com/auth/documents`, **remove it** —
it's sensitive, it's what triggers the verification prompt, and it is no longer
used.

**Already published with the wrong scopes?** The consent screen stays editable —
nothing needs unpublishing. Google moved this page, so it's either
*Google Auth Platform → Data Access → Add or remove scopes* (newer console) or
*OAuth consent screen → Edit App → Scopes* (older one). A scope won't appear in
the picker until its API is enabled.

Note that the scopes registered here and the scopes actually requested are
separate: the request comes from `SCOPES` in `src/store/googleAuth.ts`. This
list is what Google displays to you and what it reviews for verification. If you
change scopes *after* authorizing, the stored refresh token does not gain them —
delete `credentials/token.json` and run `npm run authorize` again.

**Publishing is not as scary as the dialog sounds.** It changes only *who may
click "Allow"* on your consent screen. It does not publish your code,
credentials, Doc, or Drive — and if a stranger ran the flow, they'd be granting
this app access to *their own* account, not yours. It's also reversible: you can
switch back to Testing at any time.

The reason to publish is that **Testing mode expires refresh tokens after 7
days**. Everything works for a week, then the daily run stops with no error
you'd notice. With only `drive.file` requested, publishing is clean — no
verification submission, no warning screen.

## 3. The document — nothing to do

Leave `GOOGLE_DOC_ID` empty. The first real run creates the doc in your Drive,
prints its URL, and remembers the id in `data/document.json`.

Don't pre-create one: under `drive.file` the app cannot open a document it did
not create, even though you own it. If you point `GOOGLE_DOC_ID` at a hand-made
doc you'll get a 403 that says exactly this.

## 4. Local config

```bash
cp .env.example .env          # then fill in the values
```

Copy `config/targets.example.json` to `config/targets.json` and fill in your
restaurant's Google Maps and Yelp URLs. To fill in the optional place ID for
the health check:

```bash
npm run resolve-place-id -- "Your Restaurant, Your City"
```

Then authorize once:

```bash
npm run authorize
```

That opens your browser, you approve, and it writes `credentials/token.json`
(mode 600). Both `.env` and `credentials/` are gitignored **and** deny-listed in
`.claude/settings.json`, so Claude can neither read nor commit them.

## 5. Verify, in this order

```bash
npm test                                   # offline tests, no network
npm run check -- --dry-run --screenshots   # live fetch + PNGs, writes nothing
npm run check                              # real run — check the doc
npm run check                              # MUST append nothing
```

That last step is the important one. Two runs, one set of entries. If the second
run appends anything, stop and fix dedupe before scheduling.

The first real run will append everything currently visible on both listings
(up to 20 from Google and 10 from Yelp). After that it only ever adds genuinely
new ones.

## 6. Schedule it

**The project must live outside `~/Desktop`** (e.g. in `~/restaurants_review`).
macOS protects Desktop, Documents and Downloads, and a launchd job does not
inherit Terminal's permission — it fails at `getcwd` with "Operation not
permitted". The alternative, granting Full Disk Access to the Node binary, would
give every script run with that Node access to the whole disk. Moving the folder
is the smaller hammer.

Edit the paths in `launchd/com.example.reviews.plist` to match your machine,
then:

```bash
cp launchd/com.example.reviews.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.example.reviews.plist
launchctl kickstart -k gui/$UID/com.example.reviews   # force a run now
```

Runs daily at 09:00, and catches up on next wake if the Mac was asleep. Output
goes to `logs/`. To stop it:
`launchctl unload ~/Library/LaunchAgents/com.example.reviews.plist`.

**Always check `logs/run.error.log` after loading.** A command that works in your
terminal can still fail under launchd — different PATH, different permissions.
That is how both of the problems above were found.

The plist pins an absolute nvm Node path, because launchd's login shell does not
initialize nvm and would otherwise use an older system Node that rejects the
required flags. If you upgrade Node, update the plist and reload the job.

A Chrome window will briefly appear during each run. That is deliberate — see
the comment in `src/browser.ts`.

---

## Optional: Google Business Profile API

Worth starting now, because approval takes days. It returns **all** reviews with
real ordering and would replace the Google scraper entirely.

1. Ask the restaurant's profile owner to add your Google account as a
   **Manager** at <https://business.google.com> (Settings → People → Add).
   Doing it this way means everything stays under your account and you never
   need the owner to re-authorize later.
2. Enable the **Business Profile API** on the same Cloud project and submit the
   [access request form](https://developers.google.com/my-business/content/prereqs).

When approval lands, tell Claude and it drops in as
`src/sources/googleBusinessProfile.ts`.

## Known limits

- **Screenshots are best-effort.** An entry without one means capture or upload
  was blocked, not that the monitor is broken. Review text is never lost for it.
- **Screenshot PNGs become link-shareable on your Drive.** Anyone with the URL
  can view them — that is the only way Docs can fetch an image to embed. They
  are screenshots of reviews already public on Google and Yelp, but it's your
  call.
- **Scraping is verified live** against a real listing: 20 Google + 10 Yelp
  reviews, newest-first, with a PNG per review. **Not yet verified: the Docs
  write and the Drive upload**, which need the credentials above.
