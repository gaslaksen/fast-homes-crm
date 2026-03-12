# Task: Build Two New Features in fast-homes-crm

## CONTEXT

Read these files first to understand the codebase:
- apps/api/src/comps/comp-analysis.service.ts
- apps/api/src/comps/comp-analysis.controller.ts
- apps/api/prisma/schema.prisma
- apps/web/src/app/leads/[id]/comps-analysis/page.tsx
- apps/web/src/lib/api.ts
- apps/api/src/leads/leads.controller.ts (for multer upload pattern)

The app uses:
- NestJS API on port 3001
- Next.js frontend on port 3000
- Prisma ORM (PostgreSQL)
- @anthropic-ai/sdk with ANTHROPIC_API_KEY in apps/api/.env
- multer for file uploads (already installed)
- pnpm monorepo

---

## FEATURE 1: AI Property Assessment

### API
Add method `generateAssessment(analysisId: string)` to `CompAnalysisService`.

It should generate a detailed wholesaler assessment using claude-haiku-4-5 covering:
- ARV confidence and comp pool strength (# comps, distances, recency, correlation scores)
- Market conditions (active vs slow based on days-old of comps, DOM data)
- Red flags (wide price spread, outliers, missing data, low match scores)
- Deal viability vs asking price (if known) — is asking above/below MAO?
- Recommended offer range with reasoning

This is NOT the existing 3-sentence aiSummary. This is a full 400-600 word assessment with clear sections.

Save result to a new CompAnalysis field: `aiAssessment String?`

Add to schema (apps/api/prisma/schema.prisma) and run migration:
```
cd apps/api && npx prisma migrate dev --name add-ai-assessment
```

Add endpoint to comp-analysis.controller.ts:
```
POST /leads/:leadId/comps-analysis/:analysisId/assessment
```

### Frontend
In `apps/web/src/app/leads/[id]/comps-analysis/page.tsx`, in the Results tab:
- Add an "AI Property Assessment" card below the existing AI Summary card
- Add "Generate Assessment" button (separate from existing "Generate AI Summary")  
- Loading state while generating
- Display the assessment with proper formatting: preserve newlines, bold any text wrapped in **bold**
- Add `compAnalysisAPI.generateAssessment(leadId, analysisId)` to `apps/web/src/lib/api.ts`

---

## FEATURE 2: Photo Analysis & Repair Estimate

### API
Add method `analyzePhotos(analysisId: string, photos: Express.Multer.File[])` to `CompAnalysisService`.

- Convert each photo to base64
- Call Claude vision using claude-opus-4-5 (fall back to claude-haiku-4-5 if needed — both support vision via the Anthropic SDK image_url content blocks)
- The Anthropic SDK vision format:
```typescript
{
  role: 'user',
  content: [
    { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64String } },
    // ... more images
    { type: 'text', text: 'Your prompt here' }
  ]
}
```
- Prompt: given property details (address, sqft, year built, condition), do room-by-room assessment, identify all repairs needed, estimate total cost as low and high range
- Parse the response to extract: full text assessment, repair cost low (number), repair cost high (number)
- Save to CompAnalysis fields: photoAnalysis String?, photoRepairLow Int?, photoRepairHigh Int?

Add these fields to schema and migrate:
```
cd apps/api && npx prisma migrate dev --name add-photo-analysis
```

Add endpoint to comp-analysis.controller.ts:
```
POST /leads/:leadId/comps-analysis/:analysisId/analyze-photos
```
Use `@UseInterceptors(FilesInterceptor('photos', 15))` and `@UploadedFiles()`.
Configure multer to store in memory (memoryStorage) so we can read buffer as base64.

### Frontend
In the Repairs tab of `apps/web/src/app/leads/[id]/comps-analysis/page.tsx`:

Add at the top of the repairs section:
1. Photo upload area: `<input type="file" multiple accept="image/*" max 15 files>`
2. Show selected photo count and filenames  
3. "Analyze Photos with AI" button
4. Loading state: "Analyzing photos..." with spinner
5. Results panel showing:
   - Full room-by-room assessment (formatted text, preserve newlines)
   - Repair cost range: "Estimated: $X – $Y"
   - "Apply to Repair Estimate" button that sets repairCosts to the midpoint
6. If analysis already exists (photoAnalysis not null), show it automatically

Add to `apps/web/src/lib/api.ts`:
```typescript
analyzePhotos: (leadId: string, analysisId: string, formData: FormData) =>
  api.post(`/leads/${leadId}/comps-analysis/${analysisId}/analyze-photos`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }),
```

---

## IMPORTANT
- Do NOT break existing functionality
- TypeScript strict — define proper interfaces, no implicit any on new code
- After all changes, run `cd apps/api && npm run build` to verify compilation
- When completely done, run: openclaw system event --text "Done: Built photo analysis and AI assessment features for fast-homes-crm comps" --mode now
