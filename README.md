# Nashville Build Insider

Mobile-first Next.js app that pulls live Nashville permit data from the Metro ArcGIS FeatureServer and turns it into a readable commercial permit feed for subcontractors.

## Stack
- Next.js 14 App Router
- TypeScript
- Tailwind CSS
- Live ArcGIS FeatureServer queries, no local database required for the v1 feed

## What v1 does
- Pulls live permit data from the Metro Nashville ArcGIS endpoint
- Uses `f=json`, `outFields=*`, `returnGeometry=false`, `returnIdsOnly=true`, and object ID chunking for reliable full fetches
- Filters to Nashville-area commercial permits with valid issue dates
- Applies default feed filters for `$250,000` to `$2,000,000`
- Shows a mobile-friendly dashboard, featured opportunities, contractor rollups, and project detail pages

## Run locally
1. Install dependencies if needed:
   ```bash
   npm install
   ```
2. Start the dev server:
   ```bash
   npm run dev
   ```
3. Open [http://localhost:3000](http://localhost:3000)
4. To preview on your phone, keep the phone on the same network and open:
   ```bash
   http://YOUR_COMPUTER_IP:3000
   ```

## Notes
- The first load can take longer because the app fetches the full ArcGIS permit dataset and normalizes it server-side.
- The app keeps a short in-process cache so repeated refreshes stay fast during local preview.
- The live JSON endpoint for the dashboard is `/api/permits`.
