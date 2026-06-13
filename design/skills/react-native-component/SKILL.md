---
name: react-native-component
description: >
  Use this skill whenever the user asks to create a single React Native component, mobile UI widget,
  or reusable native component — NOT a full mobile app. Triggers: "create a React Native component",
  "build a mobile card", "make a native modal", "React Native button", "Expo component",
  "mobile UI widget", "native list component".
  Also use when the user wants a single component for an existing React Native/Expo project.
  Do NOT use for full mobile apps (use mobile-app-development skill instead).
  Do NOT use for web React components (use react-component skill instead).
---

# React Native Component Creation Skill

You are an expert React Native developer creating polished, cross-platform mobile components. Follow these guidelines strictly.

## Template

This skill uses the **Expo App** starter template.

- **Template Name**: `Expo App`
- **GitHub Repo**: `Amplytic-Labs/Expo-Starter-Template`
- **Injection**: Call `inject_template` with `templateName: "Expo App"`.

## Step-by-Step Workflow

### Step 1: Analyze the Component

Before writing any code:

1. Identify the component's purpose and props API
2. List all visual states (default, active, disabled, loading, error)
3. Determine if it needs platform-specific behavior (iOS vs Android)
4. Check if any template UI components can be reused

### Step 2: Inject Template

Call `inject_template` with `templateName: "Expo App"`. Wait for the template to be available.

### Step 3: Build the Component

Create the component in `components/`:

```jsx
// components/ProfileCard.jsx
import { View, Text, Image, Pressable } from 'react-native';
import { useState } from 'react';

export function ProfileCard({ name, role, avatar, onPress }) {
  const [isPressed, setIsPressed] = useState(false);

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setIsPressed(true)}
      onPressOut={() => setIsPressed(false)}
      className={`bg-white rounded-2xl p-4 shadow-sm ${isPressed ? 'opacity-80' : ''}`}
      accessibilityLabel={`Profile card for ${name}`}
      accessibilityRole="button"
    >
      <View className="flex-row items-center">
        <Image source={{ uri: avatar }} className="w-12 h-12 rounded-full" accessibilityLabel={`${name}'s avatar`} />
        <View className="ml-3 flex-1">
          <Text className="text-lg font-semibold text-gray-900">{name}</Text>
          <Text className="text-sm text-gray-500">{role}</Text>
        </View>
      </View>
    </Pressable>
  );
}
```

### Step 4: Create the Showcase

Integrate the component into the app's main screen:

```jsx
// app/index.jsx
import { View, FlatList, Text } from 'react-native';
import { ProfileCard } from '@/components/ProfileCard';

const sampleData = [
  { id: '1', name: 'Sarah Chen', role: 'Product Designer', avatar: 'https://images.pexels.com/photos/...' },
  // ... 5-10 realistic items
];

export default function HomeScreen() {
  return (
    <View className="flex-1 bg-gray-50 p-4">
      <Text className="text-2xl font-bold mb-4">Component Demo</Text>
      <FlatList
        data={sampleData}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View className="mb-3">
            <ProfileCard {...item} />
          </View>
        )}
      />
    </View>
  );
}
```

### Step 5: Handle All States

Every component must demonstrate:

- **Default state** — normal rendering
- **Loading state** — skeleton or spinner
- **Empty state** — friendly message
- **Error state** — error with retry
- **Disabled state** — visually dimmed, non-interactive

## NativeWind v4 Styling Rules

CRITICAL — NativeWind limitations you MUST respect:

| Feature                        | Supported    | Workaround                              |
| ------------------------------ | ------------ | --------------------------------------- |
| `className="bg-blue-500"`      | Yes          | —                                       |
| `className="bg-blue-500/50"`   | **NO**       | Use `bg-blue-500 opacity-50` separately |
| `className="text-[14px]"`      | **NO**       | Use exact Tailwind scale values         |
| `className="hover:bg-red-500"` | **Web only** | Use `Pressable` with state              |
| Dark mode (`dark:`)            | Yes          | With theme configuration                |

## Template UI Components

The Expo App template provides 30+ UI components in `components/ui/`. Always prefer these:

| Component                       | Use For                |
| ------------------------------- | ---------------------- |
| `button.jsx`                    | Buttons, CTAs          |
| `card.jsx`                      | Content cards          |
| `input.jsx`                     | Text inputs            |
| `badge.jsx`                     | Status labels          |
| `avatar.jsx`                    | User avatars           |
| `skeleton.jsx`                  | Loading placeholders   |
| `dialog.jsx`                    | Modal dialogs          |
| `alert.jsx`                     | Alert messages         |
| `tabs.jsx`                      | In-screen tabs         |
| `progress.jsx`                  | Progress bars          |
| `switch.jsx`                    | Toggle controls        |
| `text.jsx`                      | Themed text            |
| `separator.jsx`                 | Visual dividers        |
| `native-only-animated-view.jsx` | Mobile-only animations |

## Performance Rules

- Use `React.memo()` for components that re-render with same props
- Use `useCallback` for handlers passed to child components
- Use `FlatList` (not `ScrollView` + map) for any list of items
- Avoid creating new objects/functions inside render
- Use `StyleSheet.create` only when NativeWind can't express the style

## Accessibility Rules

Every component MUST have:

1. `accessibilityLabel` on all interactive elements
2. `accessibilityRole` matching the element's purpose
3. Minimum **44×44pt** touch target size
4. `accessibilityHint` for non-obvious interactions
5. `accessibilityState` for toggle/expand states

```jsx
<Pressable
  accessibilityLabel="Delete item"
  accessibilityRole="button"
  accessibilityHint="Removes this item from the list"
  accessibilityState={{ disabled: isDeleting }}
  style={{ minHeight: 44, minWidth: 44 }}
>
```

## Critical Rules

1. **NEVER use opacity in color values** — `bg-blue-500/50` crashes in NativeWind
2. **ALWAYS use Pexels** for image URLs — never Unsplash or placeholder services
3. **ALWAYS use template UI components** — don't recreate button, card, etc.
4. **NEVER hardcode platform-specific code** without `Platform.OS` check
5. **ALWAYS add accessibility props** — every interactive element
6. **ALWAYS use FlatList** for lists, not ScrollView with map
7. **NEVER use `StyleSheet.create`** when className/NativeWind works
8. **ALWAYS verify imports** — match exact export names from template components

## Output Format

When creating a React Native component, produce:

1. Updated `package.json` with new dependencies (if any)
2. Shell command: `npm install` (if dependencies changed)
3. Component file in `components/`
4. Updated `app/index.jsx` to showcase the component
5. Start command as the LAST action (check `package.json` scripts)
