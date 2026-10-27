# 12 — Practical Developer & Maintenance Guide

This guide provides practical instructions for developing, testing, maintaining, and extending this project.

---

## 1. Quickstart: Running the Entire System

Open three separate terminals in PowerShell or Bash:

### Terminal 1: Strapi 5 Headless CMS
```powershell
cd c:\Users\ADMIN\OneDrive\Desktop\automate\my-strapi
npm run develop
```
- Admin Panel: `http://localhost:1337/admin`
- GraphQL Playground: `http://localhost:1337/graphql`

### Terminal 2: Word-to-Strapi Microservice
```powershell
cd c:\Users\ADMIN\OneDrive\Desktop\automate\word-to-strapi-service
npm run dev
```
- Health Check: `http://localhost:3001/health`

### Terminal 3: Svelte Frontend
```powershell
cd c:\Users\ADMIN\OneDrive\Desktop\automate
npm run dev
```
- Web Application: `http://localhost:5173`

---

## 2. Recipe: Adding a New Field from Strapi to Svelte via GraphQL

Suppose you want to add a `subtitle` field to the Article collection and display it in the frontend.

### Step 1: Add the Field in Strapi
1. Open the Strapi Admin Panel at `http://localhost:1337/admin`.
2. Go to **Content-Type Builder → Collection Types → Article**.
3. Click **Add another field** → Choose **Text (Short text)** → Name: `subtitle`.
4. Click **Finish** and **Save**.
5. *Or manually edit `my-strapi/src/api/article/content-types/article/schema.json`*:
   ```json
   "subtitle": {
     "type": "string"
   }
   ```

### Step 2: Grant Public Permissions (if using public mode)
1. Go to **Settings → Users & Permissions plugin → Roles → Public**.
2. Under **Article**, verify that **find** and **findOne** are checked.
3. Click **Save**.

### Step 3: Query the Field via GraphQL
1. In the frontend GraphQL Explorer (`http://localhost:5173`), in the **Live Data Query** box:
   - Collection Name: `articles`
   - Fields: `Title, subtitle`
   - Click **Run Query**.
2. The generated query will fetch:
   ```graphql
   query Fetch_articles {
     articles {
       documentId
       Title
       subtitle
     }
   }
   ```

### Step 4: Map the Field in Word Automation (Optional)
If you want the Word importer to extract `subtitle` from `.docx` files:
1. Open `word-to-strapi-service/src/schema.ts`.
2. Add `subtitle` to `StrapiArticlePayloadSchema`:
   ```typescript
   export const StrapiArticlePayloadSchema = z.object({
     Title: z.string().max(255).nullable().optional(),
     subtitle: z.string().max(255).nullable().optional(),
     // ...
   });
   ```
3. Update `buildStrapiPayload(fields)` in `schema.ts`:
   ```typescript
   if (fields.subtitle) payload.subtitle = fields.subtitle.trim();
   ```

---

## 3. Recipe: Adding a New Tab or View in the Svelte Frontend

1. Create your new component file in `src/lib/`, e.g. `src/lib/SettingsPage.svelte`:
   ```svelte
   <script>
     // Component logic
   </script>
   <div class="glass-card p-6">
     <h2 class="text-lg font-bold">Settings</h2>
   </div>
   ```
2. Open `src/App.svelte`:
   - Import the component:
     ```javascript
     import SettingsPage from './lib/SettingsPage.svelte'
     ```
   - Add a tab button in the navigation bar:
     ```svelte
     <button
       class="btn text-xs px-3 py-1.5"
       style="border-radius: 7px; transition: background 0.2s; {activeTab === 'settings' ? 'background: linear-gradient(135deg,#6366f1,#8b5cf6); color:white;' : 'background:transparent; color:var(--text-muted);'}"
       on:click={() => activeTab = 'settings'}
     >⚙ Settings</button>
     ```
   - In `<main>`, add the conditional rendering branch:
     ```svelte
     {#if activeTab === 'import'}
       <ImportPage />
     {:else if activeTab === 'settings'}
       <SettingsPage />
     {:else}
       <!-- Existing Explorer Layout -->
     {/if}
     ```

---

## 4. How to Run Automated Backend Tests

The `word-to-strapi-service` includes comprehensive unit tests verifying Zod schemas, Mammoth extraction, slugification, and field independence:

```powershell
cd c:\Users\ADMIN\OneDrive\Desktop\automate\word-to-strapi-service
npm test
```

To run tests in watch mode during development:
```powershell
npm run test:watch
```

---

## 5. Troubleshooting & Debugging

| Symptom | Diagnostic Step | Root Cause & Resolution |
|---|---|---|
| **Frontend displays "Failed" / Red Dot** | Check terminal running Strapi (:1337) | Strapi is not running or crashed. Run `npm run develop` in `my-strapi/`. |
| **DataViewer shows "Cannot query field..."** | Verify field name casing in Strapi Admin | Strapi field names are case-sensitive. E.g. `Title` is capitalized in `schema.json`. |
| **Import returns "Cannot reach import service"** | Check terminal running `word-to-strapi-service` | The microservice on port 3001 is stopped. Run `npm run dev` in `word-to-strapi-service/`. |
| **Confirm returns 401 Unauthorized** | Inspect `word-to-strapi-service/.env` | `STRAPI_API_TOKEN` is invalid or expired. Re-generate a Custom token in Strapi Admin. |
| **Confirm returns 403 Forbidden** | Check API Token permissions in Strapi Admin | Ensure token has permissions for **Article: create, find** and **Upload: upload**. |
| **Confirm returns 409 Conflict** | An article draft with the same title exists | Strapi already holds an article with that title. Modify the title or delete the existing draft in Strapi Admin. |
