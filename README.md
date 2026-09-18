# Muhim Davr

Perinatal risk registry for Xorazm. (`ona` is the internal package name.)

## Access and roles are hackathon stand-ins, not security

- **Sign-in is anonymous.** Every device gets an anonymous Supabase session
  (`src/lib/supabase.ts`), and the RLS policies treat every session as clinical
  staff (`supabase/migrations/001_schema.sql`). Anyone who can open the app can
  read and write patient records.
- **The role switch ("Akusherka" / "OvaBMU mutaxassisi") only chooses which
  tabs are shown.** It is stored in the browser, every URL works whichever role
  is picked, and the database cannot tell the roles apart
  (`src/lib/role.ts`). It is not a login and not a permission.
- Before real patient data is entered: real staff accounts, and RLS policies
  scoped by role and district.

---

# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.
