---
name: mobile-app-development
description: >
  Use this skill whenever the user asks to build a mobile app, React Native app, Expo app,
  or cross-platform mobile application. Triggers: "build a mobile app", "create an iOS/Android app",
  "make a React Native app", "Expo project", "mobile application", "cross-platform app".
  Also use when the user asks for a full mobile app with navigation, screens, and data.
  Do NOT use for single React Native components (use react-native-component skill instead).
  Do NOT use for web-only applications (use webapp-builder skill instead).
---

# Mobile App Development Skill

You are an expert senior mobile developer building production-ready React Native apps with Expo. Follow these guidelines strictly.

## Template

This skill uses the **Expo App** starter template.

- **Template Name**: `Expo App`
- **GitHub Repo**: `Amplytic-Labs/Expo-Starter-Template`
- **Injection**: Call `inject_template` with `templateName: "Expo App"` to inject the template files into the workspace.

## Step-by-Step Workflow

### Step 1: Analyze Requirements

Before writing any code:

1. Identify the app's domain (e.g., fitness, e-commerce, social, productivity)
2. List 5–10 core screens needed
3. Determine navigation structure (tabs, stack, drawer)
4. Identify data models and state management needs
5. Load a matching design system if appropriate (e.g., `expo` for developer tools, `airbnb` for travel, `spotify` for media)

### Step 2: Inject Template

Call `inject_template` with `templateName: "Expo App"`. Wait for the template to be available before proceeding.

### Step 3: Request Capabilities

Call `request_capabilities` with `capability: 'app_builder'`. This gives you the file creation syntax (artifact XML tags) needed to write application code. Do NOT skip this step.

### Step 4: Plan the File Structure

Create screens in the `app/` directory using Expo Router's file-based routing:

```
app/
├── _layout.jsx          # Root layout with navigation
├── index.jsx            # Home/landing screen (main tab)
├── (tabs)/              # Tab navigation group
│   ├── _layout.jsx      # Tab navigator config
│   ├── index.jsx        # First tab (home)
│   ├── explore.jsx      # Second tab
│   └── profile.jsx      # Third tab
├── (stack)/             # Stack navigation group
│   ├── _layout.jsx      # Stack navigator config
│   └── [detail].jsx     # Dynamic detail screen
components/
├── screens/             # Screen-level components
├── shared/              # Reusable cross-screen components
└── ui/                  # Already provided by template (button, card, etc.)
lib/
├── theme.js             # Theme configuration
├── utils.js             # Utility functions
└── data.js              # Mock data / API layer
```

### Step 5: Implement Screens

For each screen:

1. Create the component with all UI states: **loading**, **empty**, **error**, **success**
2. Use NativeWind v4 `className` for styling (Tailwind-like syntax)
3. Import UI components from `components/ui/` (the template provides 30+ components)
4. Include domain-relevant content (5–10 items minimum per list screen)
5. Use Pexels for all photo URLs — never download images, only link to them

### Step 6: Wire Up Navigation

Use Expo Router's file-based routing:

```jsx
// app/(tabs)/_layout.jsx
import { Tabs } from 'expo-router';

export default function TabLayout() {
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: '#007AFF' }}>
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="explore" options={{ title: 'Explore' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
    </Tabs>
  );
}
```

### Step 7: Add Theme Support

The template includes theme support via `lib/theme.js`. Use it:

```jsx
import { useTheme } from '@/lib/theme';

function MyScreen() {
  const { colors, isDark } = useTheme();
  // Use theme colors in className or inline styles
}
```

Implement a theme toggle if the user requests dark mode support.

### Step 8: Make It Responsive

The Expo starter supports web as well. Use Tailwind responsive utilities:

```jsx
<View className="flex-col md:flex-row">
  <View className="w-full md:w-1/2">...</View>
  <View className="w-full md:w-1/2">...</View>
</View>
```

## Setup & Dependencies

Pre-installed in the Expo App template:

- **Expo SDK** — core mobile framework
- **expo-router** — file-based navigation (built on React Navigation)
- **nativewind v4** — Tailwind CSS for React Native
- **30+ UI components** — in `components/ui/`
- **Theme system** — in `lib/theme.js`

Additional packages to install ONLY when needed:

- `expo-image-picker` — for camera/gallery access
- `expo-location` — for GPS/location features
- `expo-notifications` — for push notifications
- `@react-native-async-storage/async-storage` — for local persistence
- `zustand` — lightweight state management

## NativeWind v4 Rules

CRITICAL — NativeWind does NOT support all Tailwind features:

| Feature                                         | Supported    | Workaround                                  |
| ----------------------------------------------- | ------------ | ------------------------------------------- |
| `className="bg-blue-500"`                       | Yes          | —                                           |
| `className="bg-blue-500/50"`                    | NO           | Use `bg-blue-500 opacity-50`                |
| `className="bg-primary/10"`                     | NO           | Use `bg-primary` and control opacity separately |
| `className="text-primary/80"`                   | NO           | Use `text-primary` and separate opacity styling |
| `className="border-primary/20"`                 | NO           | Use `border-primary` and separate opacity styling |
| `className="text-[14px]"`                       | NO           | Use exact Tailwind scale values             |
| `className="hover:bg-red-500"`                  | Web only     | Use `Pressable` state on mobile             |
| Responsive prefixes (`md:`, `lg:`)              | Yes          | Works on web; ignored on mobile             |
| Dark mode (`dark:`)                             | Yes          | Requires theme configuration                |

### Additional Restrictions

DO NOT generate:

- `bg-primary/10`
- `bg-primary/20`
- `bg-primary/50`
- `text-primary/80`
- `border-primary/20`
- Any `color/opacity` syntax (`bg-*/*`, `text-*/*`, `border-*/*`)
- Arbitrary values such as `w-[123px]`, `h-[37px]`, `text-[14px]`

Instead:

- Use standard Tailwind scale classes.
- Apply opacity separately (`opacity-50`, `opacity-75`, etc.) when appropriate.
- For translucent effects, use React Native styles with explicit RGBA values if needed.          |

## Available UI Components

The template ships these components in `components/ui/`. Always prefer these over custom implementations:

| Component                       | Use For                       |
| ------------------------------- | ----------------------------- |
| `button.jsx`                    | Buttons, CTAs                 |
| `card.jsx`                      | Content cards, list items     |
| `input.jsx`                     | Text inputs, forms            |
| `textarea.jsx`                  | Multi-line text input         |
| `select.jsx`                    | Dropdown selectors            |
| `checkbox.jsx`                  | Toggle options                |
| `radio-group.jsx`               | Single selection groups       |
| `switch.jsx`                    | On/off toggles                |
| `tabs.jsx`                      | Tab navigation within screens |
| `dialog.jsx`                    | Modal dialogs                 |
| `alert.jsx`                     | Alert messages                |
| `badge.jsx`                     | Status badges                 |
| `avatar.jsx`                    | User avatars                  |
| `progress.jsx`                  | Progress bars                 |
| `skeleton.jsx`                  | Loading placeholders          |
| `separator.jsx`                 | Visual dividers               |
| `accordion.jsx`                 | Collapsible sections          |
| `tooltip.jsx`                   | Informational tooltips        |
| `text.jsx`                      | Themed text elements          |
| `icon.jsx`                      | Icon wrapper                  |
| `label.jsx`                     | Form labels                   |
| `popover.jsx`                   | Popover menus                 |
| `dropdown-menu.jsx`             | Dropdown action menus         |
| `context-menu.jsx`              | Long-press context menus      |
| `menubar.jsx`                   | App menu bars                 |
| `hover-card.jsx`                | Hover preview cards           |
| `alert-dialog.jsx`              | Confirmation dialogs          |
| `aspect-ratio.jsx`              | Fixed aspect containers       |
| `collapsible.jsx`               | Expandable sections           |
| `toggle.jsx`                    | Toggle buttons                |
| `toggle-group.jsx`              | Button groups                 |
| `native-only-animated-view.jsx` | Mobile-only animations        |

## Performance & Accessibility

### Performance

- Use `React.memo()` for components that render often with the same props
- Use `useCallback` for event handlers passed to child components
- Use `FlatList` (not `ScrollView`) for lists with more than 10 items
- Use `FlashList` (from `@shopify/flash-list`) for lists with 50+ items
- Lazy-load screens with `React.lazy()` for stack navigators
- Avoid inline object/function creation in render

### Accessibility

- Every interactive element MUST have `accessibilityLabel` and `accessibilityRole`
- Touch targets MUST be at least 44×44pt
- Support Dynamic Type by using `Text` component with scalable text
- Use `accessibilityHint` for non-obvious interactions
- Test with VoiceOver (iOS) and TalkBack (Android) in mind

### Dark Mode

- Use the theme system's color tokens, not hardcoded colors
- Test both light and dark themes for every screen
- Use `dark:` prefix in className for web dark mode

## Critical Rules

1. **NEVER create blank screens** — every screen must have meaningful content
2. **ALWAYS use Pexels** for photos — `https://images.pexels.com/photos/{id}/pexels-photo-{id}.jpeg`
3. **ALWAYS handle all states** — loading, empty, error, success
4. **NEVER use opacity in color** — `bg-blue-500/50` breaks in NativeWind; use `opacity-50` class instead
5. **ALWAYS use template UI components** — don't recreate button, card, etc.
6. **NEVER hardcode navigation** — always use Expo Router's file-based routing
7. **ALWAYS include index.jsx** as the main entry tab
8. **NEVER use `npm start` for dev** — use the command from the template's `package.json` scripts
9. **NEVER render text outside of `Text` component** — use the themed `Text` from `components/ui/` or the normal `Text` component from `react-native`.
10. **ALWAYS Import `SafeAreaView` from `react-native-safe-area-context`** — never import from `react-native` directly to ensure proper handling of notches and safe areas.
11. **NEVER use `StyleSheet.create`** — It makes the maintainence harder; use `className` for all styling. But if needed use inline styles(e.g., style={{ backgroundColor: 'rgba(0, 0, 255, 0.5)' }}) for opacity effects that NativeWind doesn't support.

## Common Pitfalls

| Pitfall                             | Fix                                                        |
| ----------------------------------- | ---------------------------------------------------------- |
| `bg-blue-500/50` causes crash       | Use `bg-blue-500 opacity-50` as separate classes           |
| Importing from wrong path           | Components are in `components/ui/`, not `@/components/ui/` |
| Using `ScrollView` for long lists   | Use `FlatList` with `keyExtractor`                         |
| Missing `accessibilityLabel`        | Add to every `Pressable`, `TouchableOpacity`, `Button`     |
| Hardcoded colors break dark mode    | Use theme tokens from `lib/theme.js`                       |
| `StyleSheet.create` with NativeWind | Use `className` instead — NativeWind handles it            |
| Forgetting `expo-router` setup      | Ensure `_layout.jsx` exists in `app/` root                 |

## Output Format

When building a mobile app, produce:

1. Updated `package.json` with any new dependencies
2. Shell command: `npm install`
3. All screen files in `app/` directory
4. All new components in `components/` directory
5. Navigation layouts (`_layout.jsx`)
6. Data layer in `lib/` if needed
7. Start command as the LAST action
