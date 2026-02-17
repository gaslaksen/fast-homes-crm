## Fast Homes CRM - Key Notes

### Architecture
- Monorepo: Turbo + pnpm (apps/web = Next.js, apps/api = NestJS, packages/shared)
- DB: SQLite via Prisma
- API runs from compiled `dist/` — must `npm run build` in apps/api after TS changes
- Shared package also needs rebuild: `npm run build` in packages/shared

### SQLite Gotchas
- No array types: `distressSignals` and `tags` stored as JSON strings (`String?`), must `JSON.stringify()` before write and `JSON.parse()` on read
- `sourceMetadata` same pattern — object serialized to JSON string
- Activity `metadata` field is `String?` — always `JSON.stringify()` objects
- No `mode: 'insensitive'` in Prisma filters for SQLite

### Patterns
- Forms use React useState + vanilla HTML (no form library)
- API has no DTOs — controller uses `@Body() body: any`
- Global ValidationPipe with `whitelist: true, forbidNonWhitelisted: true` (skipped for `any` type)