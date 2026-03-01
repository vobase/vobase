# React Component Code Quality Guide

Rules for writing and reviewing React components. Apply when creating new components or refactoring existing ones.

---

## 1. Type Safety

- **No unsafe casts.** Never chain `as Record<string, unknown>` on metadata or API responses. Create typed helper functions with runtime guards instead.
- **Shared type guards.** Extract predicates like `isRecord(v)` into `src/lib/guards.ts`. Never duplicate them across files.
- **Use SDK types.** Import status enums and const arrays from shared packages. Never redefine them in UI code.

## 2. DRY / Reusability

- **Centralize status mappings.** Status-to-color, status-to-label, status-to-icon mappings belong in a single `src/lib/status.ts` module. Never scatter them across components.
- **Extract shared logic into hooks.** If two components perform the same mutation, extract it into a shared hook in `src/hooks/`.
- **One source of truth for API paths.** Define route constants in `src/lib/api.ts`. Never hardcode API paths in components or hooks.

## 3. YAGNI / Dead Code

- **Remove dead UI.** Buttons without handlers (search, filter, settings placeholders) must be removed or wired up — never ship no-op controls.
- **Remove dead code paths.** Unreachable error handlers should be deleted.
- **No optimistic updates without matching types.** If the mutation return type doesn't match the cache shape, skip optimistic update or fix the type contract.

## 4. Data Integrity

- **Never compute aggregates from partial data.** Thread counts, file counts, etc. must come from the API. Client-side `.filter().length` on paginated data gives wrong numbers.
- **Deduplicate on the server.** Client-side dedup + sorting of API results masks backend bugs. Fix the API instead.

## 5. Error Handling

- **Always handle mutation errors.** Every `useMutation` call needs an `onError` callback — at minimum a notification. Never silently swallow failures.
- **No empty catch blocks.** Catch must log, notify, or rethrow.

## 6. Accessibility

- **Use semantic components.** shadcn/ui components (built on Radix UI) provide keyboard navigation and ARIA roles for free. Never rebuild these from raw HTML elements.
- **Add `aria-label`** to icon-only buttons and interactive elements without visible text.
- **Keyboard navigation.** Custom list items need `role`, `tabIndex`, and key handlers.

---

## 7. Styling — Tailwind CSS

### Utility classes first (default)

Use Tailwind utility classes directly on elements. This is the primary styling method.

```tsx
<div className="flex items-center gap-2 rounded-md bg-muted p-4">
  <span className="text-sm text-muted-foreground">Status</span>
</div>
```

### CSS Modules for complex/repeated patterns

When a component has complex hover/focus/animation states, use a co-located `.module.css` file:

```css
/* thread-list.module.css */
.item {
  @apply px-3 py-2 rounded-md;
}

.item:hover {
  @apply bg-accent;
}

.active {
  @apply bg-primary/10;
}
```

```tsx
import classes from './thread-list.module.css';
<div className={cn(classes.item, isActive && classes.active)} />
```

### Class merging with `cn()`

Always use the `cn()` utility for conditional or merged classes:

```tsx
import { cn } from "@/lib/utils";

<button className={cn(
  "px-4 py-2 rounded-md",
  variant === "primary" && "bg-primary text-primary-foreground",
  disabled && "opacity-50 cursor-not-allowed"
)} />
```

### Never use inline `style={{}}` with theme tokens

If you're writing CSS variable references inside a `style` prop, you should be using Tailwind classes instead.

---

## 8. Component Variants with CVA

Use `class-variance-authority` for reusable variant logic:

```tsx
import { cva } from "class-variance-authority";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        secondary: "bg-secondary text-secondary-foreground",
        destructive: "bg-destructive text-destructive-foreground",
        outline: "border border-input",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);
```

---

## 9. Effects & State

- **Don't reset form state on refetch.** If an effect syncs form state from query data, it will overwrite user edits when the query refetches. Use `defaultValues` + `key` prop instead.
- **Keep effect deps honest.** Never suppress the exhaustive-deps lint rule.
- **Prefer `Intl.RelativeTimeFormat` over hand-rolled time formatting.**

```ts
const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
rtf.format(-5, 'minute'); // "5 minutes ago"
```
