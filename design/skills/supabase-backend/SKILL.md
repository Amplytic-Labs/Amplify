---
name: supabase-backend
description: Supabase backend integration for web and mobile apps. Covers SQL migrations, Row Level Security (RLS), client setup, email/password auth, data preservation rules, and security best practices. Use when the user's project uses Supabase as the backend.
---

# Supabase Backend Skill

> For projects using Supabase as the database and auth provider

---

## Data Preservation (CRITICAL)

DATA INTEGRITY IS HIGHEST PRIORITY — users must NEVER lose data.

- **FORBIDDEN**: Destructive operations (`DROP`, `DELETE`) that could cause data loss
- **FORBIDDEN**: Transaction control (`BEGIN`, `COMMIT`, `ROLLBACK`, `END`)
  - Note: `DO $$ BEGIN ... END $$` blocks (PL/pgSQL) are allowed

---

## SQL Migrations

For EVERY database change, provide TWO actions:

1. **Migration File**: `<amplifyAction type="supabase" operation="migration" filePath="/supabase/migrations/name.sql">`
2. **Query Execution**: `<amplifyAction type="supabase" operation="query" projectId="${projectId}">`

### Migration Rules

- NEVER use diffs — ALWAYS provide COMPLETE file content
- Create a **new** migration file for each change in `/home/project/supabase/migrations`
- NEVER update existing migration files
- Descriptive names without number prefix (e.g., `create_users.sql`)
- ALWAYS enable RLS: `ALTER TABLE users ENABLE ROW LEVEL SECURITY;`
- Add appropriate RLS policies for CRUD operations
- Use default values: `DEFAULT false/true`, `DEFAULT 0`, `DEFAULT ''`, `DEFAULT now()`
- Start with a markdown summary in a multi-line comment explaining changes
- Use `IF EXISTS` / `IF NOT EXISTS` for safe operations

### Example Migration

```sql
/*
  # Create users table
  1. New Tables: users (id uuid, email text, created_at timestamp)
  2. Security: Enable RLS, add read policy for authenticated users
*/
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own data" ON users FOR SELECT TO authenticated USING (auth.uid() = id);
```

---

## Client Setup

- Use `@supabase/supabase-js`
- Create a **singleton** client instance
- Use environment variables from `.env`:

```typescript
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);
```

The `.env` file is created automatically with the user's credentials when Supabase is connected.

---

## Authentication

- ALWAYS use **email/password** signup
- FORBIDDEN: magic links, social providers, SSO (unless the user explicitly requests them)
- FORBIDDEN: custom auth systems — ALWAYS use Supabase's built-in auth
- Email confirmation is ALWAYS **disabled** unless the user states otherwise

```typescript
// Signup
const { data, error } = await supabase.auth.signUp({
  email,
  password,
});

// Login
const { data, error } = await supabase.auth.signInWithPassword({
  email,
  password,
});

// Logout
await supabase.auth.signOut();

// Get current user
const {
  data: { user },
} = await supabase.auth.getUser();
```

---

## Security & RLS

- ALWAYS enable RLS for every new table
- Create policies based on user authentication
- One migration per logical change
- Use descriptive policy names
- Add indexes for frequently queried columns

### Common Policy Patterns

```sql
-- Authenticated users can read their own data
CREATE POLICY "Users read own data" ON table_name
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- Authenticated users can update their own data
CREATE POLICY "Users update own data" ON table_name
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

-- Authenticated users can insert their own data
CREATE POLICY "Users insert own data" ON table_name
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Public read access (e.g., for published content)
CREATE POLICY "Public read" ON table_name
  FOR SELECT TO anon
  USING (is_published = true);
```

---

## .env Variables

When Supabase is connected, the following are injected automatically:

```
VITE_SUPABASE_URL=<project-url>
VITE_SUPABASE_ANON_KEY=<anon-key>
```

Access via `import.meta.env.VITE_SUPABASE_URL` and `import.meta.env.VITE_SUPABASE_ANON_KEY`.
